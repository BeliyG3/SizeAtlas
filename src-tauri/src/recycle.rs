//! Moving items to the trash: checks against the disk, the trash of the OS item by item, then
//! one change of the tree and one saved scan.

use std::fs;
use std::io;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use std::time::{Duration, Instant};

use sizeatlas_core::cache::cache_path;
use sizeatlas_core::scanner::mtime_of;
use sizeatlas_core::tree::flags;

use crate::dto::{TrashDto, TrashFailureDto, TrashProgressDto};
use crate::error::CmdError;
use crate::queue::TrashedPath;
use crate::state::{AppState, TrashItem, TrashPlan, Trashed};
use crate::{baseline, jobs, sources};

/// Moves `ids` of the tree with `generation` (at revision `rev`) to the trash with `trash_one`:
/// the OS trash, a permanent delete (`purge::delete`) or a stand-in in tests. `allowed(item)`
/// says whether the item may go: [`bin_takes`] for the trash (it would go to the trash rather
/// than be deleted for good), plus the clean-up re-check for clean-up rows (see
/// `membership::run_rows`). The caller holds `begin_write`, so no refresh changes the tree
/// meanwhile and closing the app waits for the saved scan.
///
/// Nothing moves when a running scan still lists an item (`Busy`, see
/// `AppState::trash_refused`) or when an item changed on disk since the scan (`Changed`). A
/// running full scan of a root that holds the items is told which went
/// (`ScanQueue::note_trashed`). After that every item is checked again right before it goes;
/// one that `allowed` refuses (`NoTrash`, `Protected`, ...), that changed (`Changed`), cannot be
/// read (`NoAccess`, `Io`) or that the OS refuses (`Io`) is reported and stays, the others go.
/// Once the app starts closing, or `AppState::stop_trash` asks for it (`stopped`), the items
/// left stay where they are. A first scan's tree is not saved here.
///
/// `report` gets the progress before each item (paced, see `Pacer`) and once at the end.
#[allow(clippy::too_many_arguments)]
pub fn run_reporting(
    state: &AppState,
    cache_dir: &Path,
    generation: u64,
    rev: u64,
    ids: &[u32],
    allowed: impl Fn(&TrashItem) -> Result<(), CmdError>,
    trash_one: impl Fn(&Path) -> Result<(), String>,
    report: impl FnMut(TrashProgressDto),
) -> Result<TrashDto, CmdError> {
    let plan = state.trash_plan(generation, rev, ids)?;
    run_plan(
        state, cache_dir, generation, plan, allowed, trash_one, report,
    )
}

/// [`run_reporting`] for a request already planned with `AppState::trash_plan`.
pub fn run_plan(
    state: &AppState,
    cache_dir: &Path,
    generation: u64,
    plan: TrashPlan,
    allowed: impl Fn(&TrashItem) -> Result<(), CmdError>,
    trash_one: impl Fn(&Path) -> Result<(), String>,
    mut report: impl FnMut(TrashProgressDto),
) -> Result<TrashDto, CmdError> {
    for item in &plan.items {
        check(item)?;
    }
    let total = plan.items.len() as u32;
    let mut pacer = Pacer::default();
    let mut trashed = Vec::new();
    let mut gone = Vec::new();
    let mut failed = Vec::new();
    let mut stopped = false;
    for (done, item) in plan.items.iter().enumerate() {
        if state.closing() {
            break;
        }
        if state.trash_stopped() {
            stopped = true;
            break;
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
            if state.closing() {
                break;
            }
            if state.trash_stopped() {
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
                trashed.push(Trashed {
                    id: item.id,
                    parent: item.parent,
                    parent_before,
                    parent_listed,
                    parent_after: modified(&item.parent_path),
                });
                gone.push(TrashedPath {
                    path: item.path.clone(),
                    parent_before: [parent_before, parent_listed],
                    parent_after: modified(&item.parent_path),
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
        state.note_trashed(gone);
        let volume = sources::volume_usage(Path::new(&plan.root));
        warning = match state.remove_trashed(generation, &trashed, volume) {
            // A first scan's tree is saved once it is complete (`worker::live::finish`): saved
            // now, it would replace a complete saved scan with a partial one.
            Some(tree) if tree.node(0).has(flags::SCANNING) => None,
            Some(tree) => {
                let saved = jobs::save(&tree, cache_dir).err();
                drop(tree);
                // Compacted: its ids changed, so its baseline is computed again.
                if state.tree(generation).is_err() {
                    baseline::refresh(state, cache_dir, &plan.root);
                }
                saved
            }
            // Closed or reopened meanwhile: its saved scan still lists what went.
            None => {
                let _ = fs::remove_file(cache_path(cache_dir, Path::new(&plan.root)));
                Some(CmdError::CacheNotSaved)
            }
        };
    }
    Ok(TrashDto {
        removed: trashed.len() as u32,
        failed,
        warning,
        stopped,
    })
}

/// `run_reporting` without the progress.
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
    let ignore = |_| ();
    run_reporting(
        state, cache_dir, generation, rev, ids, allowed, trash_one, ignore,
    )
}

/// `NoTrash` unless `can_recycle` (`sizeatlas_core::can_recycle`) says the item goes to the trash
/// rather than being deleted for good, judged by the larger of its size on disk and its length.
pub fn bin_takes(
    item: &TrashItem,
    can_recycle: impl Fn(&Path, u64) -> bool,
) -> Result<(), CmdError> {
    if can_recycle(&item.path, item.size.max(item.len)) {
        Ok(())
    } else {
        Err(CmdError::NoTrash)
    }
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

/// The item still is what the scan saw: the same kind, the same modification time (its own,
/// or as its folder lists it: the scan takes a folder's time from the listing).
// ponytail: an item changed after the scan whose folder listing still shows the old time
// passes; the trash can be undone and the confirmation shows the path and the scan date. A
// clean-up row, which may be deleted for good, does not rely on this: `recheck` walks it on
// disk right before (see `membership::run_rows`).
fn check(item: &TrashItem) -> Result<(), CmdError> {
    match fs::symlink_metadata(&item.path) {
        Ok(meta)
            if meta.is_dir() == item.is_dir
                && unchanged(item.mtime, mtime_of(&meta), || listed_mtime(&item.path)) =>
        {
            Ok(())
        }
        Ok(_) => Err(CmdError::Changed),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Err(CmdError::Changed),
        Err(e) => Err(CmdError::io(&item.path, e)),
    }
}

/// Whether the `stored` time of an item is the one it has: its `own` time or, only if that
/// differs, the time of its entry in the listing of its folder. On Windows the listing can lag
/// behind the item's own time, and a scan stores the listed time of a folder.
fn unchanged(stored: i64, own: i64, listed: impl FnOnce() -> Option<i64>) -> bool {
    own == stored || listed() == Some(stored)
}

fn modified(path: &Path) -> Option<i64> {
    fs::symlink_metadata(path).ok().map(|meta| mtime_of(&meta))
}

/// Modification time of `path` as the listing of its folder has it.
fn listed_mtime(path: &Path) -> Option<i64> {
    let (folder, name) = (path.parent()?, path.file_name()?);
    let entry = fs::read_dir(folder)
        .ok()?
        .flatten()
        .find(|e| e.file_name() == name)?;
    entry.metadata().ok().map(|meta| mtime_of(&meta))
}

/// The trash of the OS: the Recycle Bin on Windows, the Trash on macOS (through NSFileManager,
/// which needs no permission to control Finder), the freedesktop trash on Linux. A panic in the
/// crate (it unwraps some system calls) is an error of this item, not of the app.
// ponytail: between `check` and this call the item can still change (the crate takes a path);
// the gap is short and the trash can be undone. See README, "Moving to the trash". The same
// short gap after `recheck` remains for `purge::delete`, which cannot be undone; closing it
// needs handle-based deletes.
pub fn move_to_trash(path: &Path) -> Result<(), String> {
    panic::catch_unwind(AssertUnwindSafe(|| {
        #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
        let mut context = trash::TrashContext::default();
        #[cfg(target_os = "macos")]
        {
            use trash::macos::{DeleteMethod, TrashContextExtMacos};
            context.set_delete_method(DeleteMethod::NsFileManager);
        }
        context.delete(path).map_err(|e| e.to_string())
    }))
    .unwrap_or_else(|_| Err("the trash of the system failed".to_owned()))
}

pub mod membership;
mod purge;

#[cfg(test)]
mod during_tests;
#[cfg(test)]
pub(crate) mod fixture;
#[cfg(test)]
mod membership_purge_tests;
#[cfg(test)]
mod membership_tests;
#[cfg(test)]
mod progress_tests;
#[cfg(test)]
mod scan_tests;
#[cfg(test)]
mod tests;
