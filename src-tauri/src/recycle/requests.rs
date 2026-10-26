//! The trash requests from their confirmation to their end. Each has the number the UI gave it,
//! a stop of its own and a place in the queue of its volume (see `writes.rs`): the requests of
//! one volume run one after another in the order they were confirmed, those of other volumes
//! meanwhile. A batch (the trash of duplicates) is one request with an entry per root, sharing
//! its number and its stop, and a place in the queue of each of its volumes.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, MutexGuard, PoisonError};

use crate::baseline;
use crate::dto::TrashDto;
use crate::error::CmdError;
use crate::state::AppState;
use crate::writes::{Turn, wait_turns};

/// A request in the registry. Not the `Ticket`: that holds the state, which holds the registry.
struct Entry {
    request: u64,
    root: String,
    volume: String,
    stop: Arc<AtomicBool>,
    /// It got past its last check before the first item (`AppState::start`).
    started: bool,
}

/// The confirmed requests that have not ended, in the order they were confirmed, and the folder
/// times they changed.
#[derive(Default)]
pub struct Requests {
    entries: Vec<Entry>,
    /// By root while it has requests: the times a removal gave a folder (before → after), so a
    /// request planned before still finds the folder unchanged (see `AppState::settled_times`).
    settled: HashMap<String, HashMap<PathBuf, Vec<(i64, i64)>>>,
}

/// A confirmed request of one root; it leaves the registry when dropped (a batch has one per
/// root).
pub struct Ticket {
    pub request: u64,
    pub root: String,
    pub volume: String,
    stop: Arc<AtomicBool>,
    state: AppState,
}

impl Ticket {
    /// A stop was asked for its volume, or the app is closing.
    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::Acquire)
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        let (request, root) = (self.request, &self.root);
        let mut requests = self.state.requests();
        requests
            .entries
            .retain(|e| e.request != request || e.root != *root);
        if !requests.entries.iter().any(|e| e.root == self.root) {
            requests.settled.remove(&self.root);
        }
    }
}

impl AppState {
    fn requests(&self) -> MutexGuard<'_, Requests> {
        self.0
            .requests
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Registers the request `request` of `root` on `volume`. `Busy` once the app is closing or
    /// when a request with that number is registered already (that one stays as it is).
    pub fn enqueue_trash(
        &self,
        request: u64,
        root: &str,
        volume: &str,
    ) -> Result<Ticket, CmdError> {
        let mut tickets = self.enqueue_batch(request, &[(root.to_owned(), volume.to_owned())])?;
        Ok(tickets.pop().expect("one root"))
    }

    /// Registers the request `request` of the roots `roots` (each with its volume, each root
    /// once): a ticket per root, one stop for all. Refused as `enqueue_trash`.
    pub fn enqueue_batch(
        &self,
        request: u64,
        roots: &[(String, String)],
    ) -> Result<Vec<Ticket>, CmdError> {
        let mut requests = self.requests();
        // Under the lock `stop_all` takes: a request either sees the app closing or is stopped.
        if self.closing() || requests.entries.iter().any(|e| e.request == request) {
            return Err(CmdError::Busy);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let mut tickets: Vec<Ticket> = Vec::with_capacity(roots.len());
        for (root, volume) in roots {
            if tickets.iter().any(|t| t.root == *root) {
                continue;
            }
            requests.entries.push(Entry {
                request,
                root: root.clone(),
                volume: volume.clone(),
                stop: stop.clone(),
                started: false,
            });
            tickets.push(Ticket {
                request,
                root: root.clone(),
                volume: volume.clone(),
                stop: stop.clone(),
                state: self.clone(),
            });
        }
        Ok(tickets)
    }

    /// The request may try its first item: `false` once it was stopped. Under the lock of
    /// `stop_volume_of`, so a stop counts it as cancelled only if it never starts.
    pub fn start(&self, request: u64) -> bool {
        let mut requests = self.requests();
        let mut started = false;
        for entry in requests.entries.iter_mut().filter(|e| e.request == request) {
            // One stop for every entry of a request.
            if entry.stop.load(Ordering::Acquire) {
                return false;
            }
            entry.started = true;
            started = true;
        }
        started
    }

    /// Stops every request of the volumes of `request` (of each of its roots): the running one
    /// before its next item, the waiting ones before they start; a batch stops on all its
    /// volumes. Returns how many waiting requests this cancelled (not those stopped before, a
    /// batch once); 0 for a request that is not registered (it ended).
    pub fn stop_volume_of(&self, request: u64) -> u32 {
        let requests = self.requests();
        let volumes: HashSet<&str> = (requests.entries.iter())
            .filter(|e| e.request == request)
            .map(|e| e.volume.as_str())
            .collect();
        let mut cancelled = HashSet::new();
        for entry in (requests.entries.iter()).filter(|e| volumes.contains(e.volume.as_str())) {
            let was_stopped = entry.stop.swap(true, Ordering::AcqRel);
            if !was_stopped && !entry.started {
                cancelled.insert(entry.request);
            }
        }
        cancelled.len() as u32
    }

    /// Stops every request, for the exit.
    pub fn stop_all(&self) {
        for entry in &self.requests().entries {
            entry.stop.store(true, Ordering::Release);
        }
    }

    /// A request of `root` is registered: its tree is not compacted (see `compact_if_idle`).
    /// May be asked with the lock of `data` held, never the other way round.
    pub(crate) fn trash_pending(&self, root: &str) -> bool {
        self.requests().entries.iter().any(|e| e.root == root)
    }

    /// A removal in `root` changed the time of `folder` from `before` to `after`. Kept only while
    /// the root has requests.
    pub(crate) fn note_settled(&self, root: &str, folder: &Path, before: i64, after: i64) {
        let mut requests = self.requests();
        if before == after || !requests.entries.iter().any(|e| e.root == root) {
            return;
        }
        let times = requests.settled.entry(root.to_owned()).or_default();
        times
            .entry(folder.to_owned())
            .or_default()
            .push((before, after));
    }

    /// The times `folder` of `root` may have now if it had `stored` and only the removals of
    /// this app changed it since: `stored` first, then each time a removal gave it after one of
    /// those (`before → after1 → after2`).
    pub(crate) fn settled_times(&self, root: &str, folder: &Path, stored: i64) -> Vec<i64> {
        let requests = self.requests();
        let mut times = vec![stored];
        let Some(changes) = requests.settled.get(root).and_then(|f| f.get(folder)) else {
            return times;
        };
        let mut at = 0;
        while let Some(&time) = times.get(at) {
            for &(before, after) in changes {
                if before == time && !times.contains(&after) {
                    times.push(after);
                }
            }
            at += 1;
        }
        times
    }
}

/// The removal of a planned request, run once its turn has come: gets the state, the folder of
/// the saved scans and the stop of the request.
pub type Work =
    Box<dyn FnOnce(&AppState, &Path, &dyn Fn() -> bool) -> Result<TrashDto, CmdError> + Send>;

/// Runs `work` in the turn of the volume (`turn`, reserved when the request was confirmed) with
/// the root's write held. A request stopped while it waited, or once the app is closing, tries
/// nothing (`TrashDto::cancelled`). The ticket goes after the saved scan; then, the last
/// request of its root gone and the app not closing, the tree is compacted if it is due
/// (`AppState::compact_if_idle`) and its baseline computed again; then the write goes, then the
/// turn. The tree is not held while items go (`work` reads it when it needs it).
pub async fn run_request(
    state: AppState,
    cache_dir: PathBuf,
    ticket: Ticket,
    turn: Turn,
    work: Work,
) -> Result<TrashDto, CmdError> {
    run_batch(state, cache_dir, vec![ticket], vec![turn], work).await
}

/// [`run_request`] of a batch: `tickets` of one request (one per root) and `turns` of all the
/// volumes it needs (`AppState::reserve_turns`), waited for together. Each time a turn comes
/// the request is let go when it was stopped or the app is closing: it holds no turn while it
/// cannot run, and leaves as a refused one does (`leave`). Then the writes of its roots, in ascending order; after `work` the tickets go,
/// then each root is compacted if due, then the writes, then the turns.
pub async fn run_batch(
    state: AppState,
    cache_dir: PathBuf,
    tickets: Vec<Ticket>,
    turns: Vec<Turn>,
    work: Work,
) -> Result<TrashDto, CmdError> {
    let stopped = || tickets.iter().any(Ticket::stopped) || state.closing();
    let Some(volumes) = wait_turns(turns, stopped).await else {
        release(state, cache_dir, tickets).await;
        return Ok(TrashDto::cancelled());
    };
    let roots: Vec<String> = tickets.iter().map(|t| t.root.clone()).collect();
    // Refused only once the app is closing.
    let Ok(write) = state.begin_writes(&roots).await else {
        return Ok(TrashDto::cancelled());
    };
    tauri::async_runtime::spawn_blocking(move || {
        let request = tickets.first().map(|t| t.request);
        let result = if request.is_some_and(|r| state.start(r)) {
            work(&state, &cache_dir, &|| tickets.iter().any(Ticket::stopped))
        } else {
            Ok(TrashDto::cancelled())
        };
        drop(tickets);
        for root in &roots {
            compact(&state, &cache_dir, root);
        }
        drop(write);
        drop(volumes);
        result
    })
    .await?
}

/// A request whose plan was refused leaves the queue: its turn, then its ticket. Was it the last
/// request of its root, the tree is compacted if it is due, as at the end of `run_request`,
/// under the root's write (none once the app is closing).
pub async fn leave(state: AppState, cache_dir: PathBuf, ticket: Ticket, turn: Turn) {
    drop(turn);
    release(state, cache_dir, vec![ticket]).await;
}

/// The tickets of a request that holds no turn go; each root they leave without requests is
/// compacted if due, under its write.
async fn release(state: AppState, cache_dir: PathBuf, tickets: Vec<Ticket>) {
    let roots: Vec<String> = tickets.iter().map(|t| t.root.clone()).collect();
    drop(tickets);
    for root in roots {
        // Asked first: the write would wait for a request of the root that runs.
        if !state.compaction_due(&root) {
            continue;
        }
        let Ok(write) = state.begin_write(&root).await else {
            return;
        };
        let (state, cache_dir) = (state.clone(), cache_dir.clone());
        let _ = tauri::async_runtime::spawn_blocking(move || {
            compact(&state, &cache_dir, &root);
            drop(write);
        })
        .await;
    }
}

/// The deferred compaction of `root`, its last request gone; the caller holds the root's write.
/// Its ids changed: the baseline is computed again. Not once the app is closing.
fn compact(state: &AppState, cache_dir: &Path, root: &str) {
    if !state.closing() && state.compact_if_idle(root) {
        baseline::refresh(state, cache_dir, root);
    }
}
