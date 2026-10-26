//! Moving items to the trash: checks against the disk, the trash of the OS item by item, then
//! one change of the tree and one saved scan.

use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use sizeatlas_core::cache::cache_path;
use sizeatlas_core::tree::flags;

use crate::dto::{TrashDto, TrashFailureDto, TrashProgressDto};
use crate::error::CmdError;
use crate::queue::TrashedPath;
use crate::state::{AppState, TrashItem, TrashPlan, Trashed};
use crate::{jobs, sources};
use disk::{check, gone, listed_mtime, modified};

/// Moves the items of `plan` (planned with `AppState::trash_plan` on the tree with `generation`)
/// to the trash with `trash_one`: the OS trash, a permanent delete (`purge::delete`) or a
/// stand-in in tests. `allowed(item)` says whether the item may go: [`bin_takes`] for the trash
/// (it would go to the trash rather than be deleted for good), plus the clean-up re-check for
/// clean-up rows (see `membership::run_rows`). The caller holds the turn of the volume and the
/// root's write (see `requests::run_request`), so no refresh changes the tree meanwhile and
/// closing the app waits for the saved scan.
///
/// Nothing moves when an item changed on disk since the scan (`Changed`); an item gone from the
/// disk meanwhile is no change, it is counted as `gone` and taken out of the tree. The tree may
/// have been rescanned or compacted since the plan: its items are found by path then (see
/// `AppState::remove_trashed`). A running full scan of a root that holds the items is told which
/// went (`ScanQueue::note_trashed`). After that every item is checked again right before it
/// goes; one that `allowed` refuses (`NoTrash`,
/// `Protected`, ...), that changed (`Changed`), cannot be read (`NoAccess`, `Io`) or that the OS
/// refuses (`Io`) is reported and stays, the others go. Once the app starts closing, or `stop`
/// says so (`stopped`), the items left stay where they are. A first scan's tree is not saved
/// here.
///
/// `report` gets the progress before each item (paced, see `Pacer`) and once at the end.
#[allow(clippy::too_many_arguments)]
pub fn run_plan(
    state: &AppState,
    cache_dir: &Path,
    generation: u64,
    plan: TrashPlan,
    allowed: impl Fn(&TrashItem) -> Result<(), CmdError>,
    trash_one: impl Fn(&Path) -> Result<(), String>,
    stop: &dyn Fn() -> bool,
    report: impl FnMut(TrashProgressDto),
) -> Result<TrashDto, CmdError> {
    check_plan(state, &plan)?;
    let (moved, _) = move_plan(
        state, cache_dir, generation, plan, allowed, trash_one, stop, report,
    );
    Ok(moved)
}

/// The ids (in the planned tree) of the items of a plan that left the disk: moved, or gone
/// already.
pub(crate) type Journal = Vec<u32>;

/// The first check of [`run_plan`]: every item not gone from the disk is still what the scan
/// saw, else `Changed` (or the error reading it).
pub(crate) fn check_plan(state: &AppState, plan: &TrashPlan) -> Result<(), CmdError> {
    for item in plan.items.iter().filter(|item| !gone(&item.path)) {
        check(
            item,
            &state.settled_times(&plan.root, &item.path, item.mtime),
        )?;
    }
    Ok(())
}

/// [`run_plan`] after [`check_plan`]: the items one by one, then the tree and its saved scan.
/// Also returns the ids of the items that left the disk. Once the app starts closing the rest
/// stays, as for a stop (`stopped`).
#[allow(clippy::too_many_arguments)]
pub(crate) fn move_plan(
    state: &AppState,
    cache_dir: &Path,
    generation: u64,
    plan: TrashPlan,
    allowed: impl Fn(&TrashItem) -> Result<(), CmdError>,
    trash_one: impl Fn(&Path) -> Result<(), String>,
    stop: &dyn Fn() -> bool,
    mut report: impl FnMut(TrashProgressDto),
) -> (TrashDto, Journal) {
    let check = |item: &TrashItem| {
        check(
            item,
            &state.settled_times(&plan.root, &item.path, item.mtime),
        )
    };
    let total = plan.items.len() as u32;
    let mut pacer = Pacer::default();
    // What left the disk, here or before (`already`), for the tree and the running scan.
    let mut trashed = Vec::new();
    let mut noted = Vec::new();
    let mut already = 0;
    let mut size = 0u64;
    let mut failed = Vec::new();
    let mut stopped = false;
    for (done, item) in plan.items.iter().enumerate() {
        if state.closing() || stop() {
            stopped = true;
            break;
        }
        if gone(&item.path) {
            already += 1;
            trashed.push(Trashed {
                id: item.id,
                path: item.path.clone(),
                parent_before: None,
                parent_listed: None,
                parent_after: None,
            });
            noted.push(TrashedPath {
                path: item.path.clone(),
                parent_before: [None, None],
                parent_after: None,
            });
            continue;
        }
        if pacer.due(Instant::now()) {
            report(TrashProgressDto {
                done: done as u32,
                total,
                current: Some(item.path.display().to_string()),
            });
        }
        let path = item.path.display().to_string();
        if let Err(error) = allowed(item) {
            // The re-check of a clean-up row gives up once a stop is asked: the item was not
            // tried, so it is no failure.
            if state.closing() || stop() {
                stopped = true;
                break;
            }
            failed.push(TrashFailureDto { path, error });
            continue;
        }
        // Again right before it goes: the items before it may have taken a while.
        if let Err(error) = check(item) {
            failed.push(TrashFailureDto { path, error });
            continue;
        }
        let parent_before = modified(&item.parent_path);
        let parent_listed = if parent_before == Some(item.parent_mtime) {
            None
        } else {
            listed_mtime(&item.parent_path)
        };
        match trash_one(&item.path) {
            Ok(()) => {
                size = size.saturating_add(item.size);
                let parent_after = modified(&item.parent_path);
                // A later request of the root planned with the folder's time before this.
                if let (Some(before), Some(after)) = (parent_before, parent_after) {
                    state.note_settled(&plan.root, &item.parent_path, before, after);
                }
                trashed.push(Trashed {
                    id: item.id,
                    path: item.path.clone(),
                    parent_before,
                    parent_listed,
                    parent_after,
                });
                noted.push(TrashedPath {
                    path: item.path.clone(),
                    parent_before: [parent_before, parent_listed],
                    parent_after,
                });
            }
            Err(os_message) => failed.push(TrashFailureDto {
                path: path.clone(),
                error: CmdError::Io { path, os_message },
            }),
        }
    }
    report(TrashProgressDto {
        done: (trashed.len() + failed.len()) as u32,
        total,
        current: None,
    });
    let mut warning = None;
    if !trashed.is_empty() {
        state.note_trashed(noted);
        let volume = sources::volume_usage(Path::new(&plan.root));
        warning = match state.remove_trashed(&plan.root, generation, &trashed, volume) {
            // A first scan's tree is saved once it is complete (`worker::live::finish`): saved
            // now, it would replace a complete saved scan with a partial one.
            Some(tree) if tree.node(0).has(flags::SCANNING) => None,
            // Not compacted while its request is registered (`requests::run_request` compacts).
            Some(tree) => jobs::save(&tree, cache_dir).err(),
            // Closed meanwhile: its saved scan still lists what went.
            None => {
                let _ = fs::remove_file(cache_path(cache_dir, Path::new(&plan.root)));
                Some(CmdError::CacheNotSaved)
            }
        };
    }
    let journal = trashed.iter().map(|t| t.id).collect();
    let moved = TrashDto {
        removed: trashed.len() as u32 - already,
        gone: already,
        size,
        failed,
        warning,
        stopped,
        cancelled: false,
    };
    (moved, journal)
}

/// [`run_plan`] for `ids` of the tree with `generation` at revision `rev`, planned here; `Busy`
/// while a running scan still lists an item (see `AppState::trash_refused`).
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub fn run_reporting(
    state: &AppState,
    cache_dir: &Path,
    generation: u64,
    rev: u64,
    ids: &[u32],
    allowed: impl Fn(&TrashItem) -> Result<(), CmdError>,
    trash_one: impl Fn(&Path) -> Result<(), String>,
    stop: &dyn Fn() -> bool,
    report: impl FnMut(TrashProgressDto),
) -> Result<TrashDto, CmdError> {
    let plan = state.trash_plan(generation, rev, ids)?;
    run_plan(
        state, cache_dir, generation, plan, allowed, trash_one, stop, report,
    )
}

/// `run_reporting` without the progress and never stopped.
#[cfg(test)]
pub fn run(
    state: &AppState,
    cache_dir: &Path,
    generation: u64,
    rev: u64,
    ids: &[u32],
    allowed: impl Fn(&TrashItem) -> Result<(), CmdError>,
    trash_one: impl Fn(&Path) -> Result<(), String>,
) -> Result<TrashDto, CmdError> {
    let never = || false;
    let ignore = |_| ();
    run_reporting(
        state, cache_dir, generation, rev, ids, allowed, trash_one, &never, ignore,
    )
}

/// The progress of a trash request at most this often: thousands of small items must not flood
/// the UI with events.
const PACE: Duration = Duration::from_millis(100);

/// Says when the next progress is due: the first one at once, then one per `PACE`.
#[derive(Default)]
struct Pacer(Option<Instant>);

impl Pacer {
    fn due(&mut self, now: Instant) -> bool {
        let due = self.0.is_none_or(|last| now.duration_since(last) >= PACE);
        if due {
            self.0 = Some(now);
        }
        due
    }
}

mod disk;
pub mod membership;
mod purge;
pub mod requests;
mod system;

pub use system::{bin_takes, move_to_trash};

#[cfg(test)]
mod compaction_tests;
#[cfg(test)]
mod during_tests;
#[cfg(test)]
pub(crate) mod fixture;
#[cfg(test)]
mod membership_purge_tests;
#[cfg(test)]
mod membership_tests;
#[cfg(test)]
mod order_tests;
#[cfg(test)]
mod progress_tests;
#[cfg(test)]
mod requests_tests;
#[cfg(test)]
mod scan_tests;
#[cfg(test)]
mod tests;
