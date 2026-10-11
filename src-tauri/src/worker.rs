//! Runs the scan queue in the background: one job at a time, until the queue is empty.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sizeatlas_core::scanner::FolderScan;
use sizeatlas_core::tree::Tree;
use tokio::sync::OwnedMutexGuard;

use crate::dto::ProgressDto;
use crate::error::CmdError;
use crate::jobs;
use crate::queue::{FolderTarget, ScanJob};
use crate::sources;
use crate::state::AppState;

const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// What the worker reports; `commands::roots` turns notices into events.
pub enum Notice {
    /// The open roots or the queue changed.
    RootsChanged,
    Progress(ProgressDto),
    /// A scan failed, or its result could not be saved (`CacheNotSaved`).
    Failed {
        root: String,
        error: CmdError,
    },
}

pub type Notify = Arc<dyn Fn(Notice) + Send + Sync>;

/// Runs `first`, then every job queued meanwhile, until the queue is empty.
pub async fn run(state: AppState, cache_dir: PathBuf, first: ScanJob, notify: Notify) {
    let mut next = Some(first);
    while let Some(job) = next {
        // A trash holds `busy` from its check to its saved scan: a walk meanwhile would see some
        // of its items gone and others not.
        // ponytail: jobs of every root wait for any trash, not only those of its root.
        state.writes_done().await;
        notify(Notice::RootsChanged);
        let done = match &job.folder {
            None => scan_one(&state, &cache_dir, &job, &notify).await,
            Some(folder) => refresh_one(&state, &cache_dir, &job, folder, &notify).await,
        };
        if let Err(error) = done {
            notify(Notice::Failed {
                root: job.root.clone(),
                error,
            });
        }
        next = state.next_scan();
    }
    notify(Notice::RootsChanged);
}

/// Walks without any lock, then installs and saves the tree while holding a write, so closing
/// the app waits for the file.
async fn scan_one(
    state: &AppState,
    cache_dir: &Path,
    job: &ScanJob,
    notify: &Notify,
) -> Result<(), CmdError> {
    let walked = {
        let _ticker = Ticker::start(job, notify.clone());
        let job = job.clone();
        tauri::async_runtime::spawn_blocking(move || jobs::walk(&job)).await??
    };
    let Some(tree) = walked else {
        return Ok(()); // cancelled
    };
    // Refused only when the app started closing before the walk ended: the scan is dropped.
    let Ok(write) = state.begin_write().await else {
        // Not on the async runtime: dropping millions of nodes takes a while.
        tauri::async_runtime::spawn_blocking(move || drop(tree));
        return Ok(());
    };
    let (state, cache_dir, job, notify) = (
        state.clone(),
        cache_dir.to_path_buf(),
        job.clone(),
        notify.clone(),
    );
    tauri::async_runtime::spawn_blocking(move || {
        install_and_save(&state, &cache_dir, &job, tree, write, &notify)
    })
    .await?
}

/// Installs a walked tree unless its root was closed or its scan cancelled meanwhile, then
/// saves it and releases `write`. Closing the app does not discard it: the exit waits.
fn install_and_save(
    state: &AppState,
    cache_dir: &Path,
    job: &ScanJob,
    tree: Tree,
    write: OwnedMutexGuard<()>,
    notify: &Notify,
) -> Result<(), CmdError> {
    let tree = Arc::new(tree);
    let Some((_, replaced)) = state.install_scan(tree.clone(), &job.discard) else {
        // Released before the discarded tree is dropped, which may take a while.
        drop(write);
        return Ok(());
    };
    notify(Notice::RootsChanged);
    let saved = jobs::save(&tree, cache_dir);
    drop(write);
    // After `busy` is released: dropping millions of nodes must not delay closing.
    drop(replaced);
    saved
}

/// Walks the folder of `job` without any lock, then changes the tree and saves it while holding
/// a write, so closing the app waits for the file.
async fn refresh_one(
    state: &AppState,
    cache_dir: &Path,
    job: &ScanJob,
    folder: &FolderTarget,
    notify: &Notify,
) -> Result<(), CmdError> {
    let walked = {
        let _ticker = Ticker::start(job, notify.clone());
        let (job, folder) = (job.clone(), folder.clone());
        tauri::async_runtime::spawn_blocking(move || jobs::walk_folder(&job, &folder)).await??
    };
    let Some(found) = walked else {
        return Ok(()); // cancelled
    };
    // Refused only when the app started closing before the walk ended: the refresh is dropped.
    let Ok(write) = state.begin_write().await else {
        return Ok(());
    };
    let (state, cache_dir, job, folder, notify) = (
        state.clone(),
        cache_dir.to_path_buf(),
        job.clone(),
        folder.clone(),
        notify.clone(),
    );
    tauri::async_runtime::spawn_blocking(move || {
        apply_refresh(&state, &cache_dir, &job, &folder, found, write, &notify)
    })
    .await?
}

/// Puts a walked folder into the tree of its scan, unless the job was cancelled, the root was
/// rescanned or closed, or no live folder has the path any more (it or an ancestor went to the
/// trash): then the result is dropped. After a compaction or a refresh of an ancestor the folder
/// is found again by its path. Saves the tree and releases `write`.
fn apply_refresh(
    state: &AppState,
    cache_dir: &Path,
    job: &ScanJob,
    folder: &FolderTarget,
    found: FolderScan,
    write: OwnedMutexGuard<()>,
    notify: &Notify,
) -> Result<(), CmdError> {
    // Measured after the walk and outside the lock, so "unaccounted" compares numbers of one time.
    let volume = sources::volume_usage(Path::new(&job.root));
    let changed = state.change_scan(folder.scan, |tree, generation| {
        if job.discard.load(Ordering::Relaxed) {
            return None;
        }
        // Renumbered by a compaction, or replaced by a refresh of an ancestor: by path.
        let same = generation == folder.generation && tree.get(folder.id).is_some();
        let id = if same {
            folder.id
        } else {
            tree.find_path(&folder.path)?
        };
        if id == 0 || !tree.node(id).is_dir() {
            return None;
        }
        match found {
            FolderScan::Done(records) => tree.replace_subtree(id, records),
            FolderScan::Gone => tree.remove(id),
            FolderScan::Cancelled => return None,
        }
        tree.volume = volume;
        Some(())
    });
    let Some(changed) = changed else {
        drop(write);
        return Ok(());
    };
    notify(Notice::RootsChanged);
    let saved = jobs::save(&changed, cache_dir);
    drop(write);
    saved
}

/// Reports the progress of a scan every 100 ms until dropped.
struct Ticker(Arc<AtomicBool>);

impl Ticker {
    fn start(job: &ScanJob, notify: Notify) -> Ticker {
        let stop = Arc::new(AtomicBool::new(false));
        let (job, stopped) = (job.clone(), stop.clone());
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(PROGRESS_INTERVAL);
                // Checked after the sleep: no progress once the walk has ended.
                if stopped.load(Ordering::Relaxed) {
                    break;
                }
                notify(Notice::Progress(progress_of(&job)));
            }
        });
        Ticker(stop)
    }
}

impl Drop for Ticker {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

fn progress_of(job: &ScanJob) -> ProgressDto {
    let p = &job.progress;
    ProgressDto {
        root: job.root.clone(),
        files: p.files.load(Ordering::Relaxed),
        dirs: p.dirs.load(Ordering::Relaxed),
        bytes: p.bytes.load(Ordering::Relaxed),
        current: p.current.lock().map(|c| c.clone()).unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod refresh_tests;
