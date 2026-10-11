//! First scans publish complete folder batches; only a completed root is saved.

use std::sync::{Mutex, PoisonError};
use std::time::Instant;

use sizeatlas_core::scanner::{self, LiveEvent, LiveOutcome};

use super::*;
mod ticker;
use ticker::LiveTicker;

const LIVE_INTERVAL: Duration = Duration::from_secs(2);

struct Current {
    id: u32,
    bytes: u64,
    files: u64,
}

struct Session {
    scan: Option<u64>,
    current: Option<Current>,
    last: Instant,
    interval: Duration,
}

impl Session {
    fn new() -> Self {
        Self {
            scan: None,
            current: None,
            last: Instant::now(),
            interval: LIVE_INTERVAL,
        }
    }

    fn publish(&mut self, state: &AppState, job: &ScanJob, event: LiveEvent, notify: &Notify) {
        match event {
            LiveEvent::Started(tree) => {
                self.scan = state.start_live(job, tree);
                notify(Notice::RootsChanged);
            }
            LiveEvent::FolderStarted { id, bytes, files } => {
                self.current = Some(Current { id, bytes, files });
                if let Some(scan) = self.scan {
                    drop(state.change_scan(scan, |tree, _| {
                        if job.discard.load(Ordering::Relaxed) {
                            return None;
                        }
                        tree.set_scanning(id, true);
                        Some(())
                    }));
                }
            }
            LiveEvent::FolderDone { id, records } => {
                self.current = None;
                if let Some(scan) = self.scan {
                    drop(state.change_scan(scan, |tree, _| {
                        if job.discard.load(Ordering::Relaxed) {
                            return None;
                        }
                        tree.replace_subtree(id, records);
                        // Hard links are deduplicated across batches by the live scanner.
                        tree.approximate = false;
                        Some(())
                    }));
                }
            }
        }
    }

    fn tick(&mut self, state: &AppState, job: &ScanJob, notify: &Notify) {
        if self.last.elapsed() < self.interval || job.cancelled() {
            return;
        }
        let start = Instant::now();
        if let (Some(scan), Some(current)) = (self.scan, &self.current) {
            let size = job
                .progress
                .bytes
                .load(Ordering::Relaxed)
                .saturating_sub(current.bytes);
            let files = job
                .progress
                .files
                .load(Ordering::Relaxed)
                .saturating_sub(current.files)
                .min(u64::from(u32::MAX)) as u32;
            drop(state.change_scan(scan, |tree, _| {
                if job.discard.load(Ordering::Relaxed) {
                    return None;
                }
                tree.set_scan_progress(current.id, size, files);
                Some(())
            }));
        }
        notify(Notice::LiveChanged);
        // At most 10% of the interval spent updating, including waits for readers. Recover
        // gradually when reads get cheaper; never go below the two-second minimum.
        self.interval = LIVE_INTERVAL
            .max(start.elapsed().saturating_mul(10))
            .max(self.interval.mul_f64(0.8));
        self.last = Instant::now();
    }
}

/// All tree edits and cleanup run in the blocking pool. The final write guard has the same
/// exit semantics as a rescan: if acquired, closing waits until the complete tree is saved.
pub(super) async fn scan_first(
    state: &AppState,
    cache_dir: &Path,
    job: &ScanJob,
    notify: &Notify,
) -> Result<(), CmdError> {
    let session = Arc::new(Mutex::new(Session::new()));
    let walked = {
        let _progress = Ticker::start(job, notify.clone());
        let (ticks, tick_state, tick_job, tick_notify) =
            (session.clone(), state.clone(), job.clone(), notify.clone());
        let _ticker = LiveTicker::start(move || {
            ticks.lock().unwrap_or_else(PoisonError::into_inner).tick(
                &tick_state,
                &tick_job,
                &tick_notify,
            );
        });
        let (batches, state, job, notify) =
            (session.clone(), state.clone(), job.clone(), notify.clone());
        tauri::async_runtime::spawn_blocking(move || {
            scanner::scan_live(Path::new(&job.root), &job.cancel, &job.progress, |event| {
                batches
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .publish(&state, &job, event, &notify);
            })
            .map_err(|e| CmdError::io(Path::new(&job.root), e))
        })
        .await
    };
    // Taking the session lock also drains any tick already in flight.
    let scan = tauri::async_runtime::spawn_blocking(move || {
        let mut session = session.lock().unwrap_or_else(PoisonError::into_inner);
        session.current = None;
        session.scan.take()
    })
    .await?;
    let walked = walked.map_err(CmdError::from).and_then(|r| r);
    let complete = matches!(walked, Ok(LiveOutcome::Done)) && !job.discard.load(Ordering::Relaxed);
    let write = if complete {
        state.begin_write().await.ok()
    } else {
        None
    };
    let (state, job, dir, notify) = (
        state.clone(),
        job.clone(),
        cache_dir.to_path_buf(),
        notify.clone(),
    );
    tauri::async_runtime::spawn_blocking(move || {
        let Some(scan) = scan else {
            return walked.map(|_| ());
        };
        let Some(write) = write else {
            state.abort_live(scan);
            return walked.map(|_| ());
        };
        finish(&state, &dir, &job, scan, write, &notify)
    })
    .await?
}

fn finish(
    state: &AppState,
    dir: &Path,
    job: &ScanJob,
    scan: u64,
    write: OwnedMutexGuard<()>,
    notify: &Notify,
) -> Result<(), CmdError> {
    let volume = sources::volume_usage(Path::new(&job.root));
    let changed = state.change_scan(scan, |tree, _| {
        if job.discard.load(Ordering::Relaxed) {
            return None;
        }
        tree.volume = volume;
        tree.approximate = false;
        tree.set_scanning(0, false);
        Some(())
    });
    let Some(tree) = changed else {
        drop(write);
        state.abort_live(scan);
        return Ok(());
    };
    notify(Notice::RootsChanged);
    let saved = jobs::save(&tree, dir);
    drop(write);
    saved
}

#[cfg(test)]
mod tests;
