//! Moving items to the trash: checks against the disk, the trash of the OS item by item, then
//! one change of the tree and one saved scan.

use std::fs;
use std::io;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;

use sizeatlas_core::cache::cache_path;
use sizeatlas_core::scanner::mtime_of;

use crate::dto::{TrashDto, TrashFailureDto};
use crate::error::CmdError;
use crate::state::{AppState, TrashItem, Trashed};
use crate::{jobs, sources};

/// Moves `ids` of the tree with `generation` (at revision `rev`) to the trash with `trash_one`:
/// the OS trash, or a stand-in in tests. `allowed(path, size)` says whether the item would go to
/// the trash rather than be deleted for good (`sizeatlas_core::can_recycle`); `size` is the larger
/// of its size on disk and its length. The caller holds `begin_write`, so no refresh changes the
/// tree meanwhile and closing the app waits for the saved scan.
///
/// Nothing moves when a running scan still lists an item (`Busy`, see `AppState::trash_refused`)
/// or when an item changed on disk since the scan (`Changed`). A running full scan of a root
/// that holds the items is told which went (`ScanQueue::note_trashed`). After that every item is checked again right before it
/// goes; one that changed (`Changed`), cannot be read (`NoAccess`, `Io`), would be deleted for
/// good (`NoTrash`) or that the OS refuses (`Io`) is reported and stays, the others go. Once the
/// app starts closing, the items left stay where they are.
pub fn run(
    state: &AppState,
    cache_dir: &Path,
    generation: u64,
    rev: u64,
    ids: &[u32],
    allowed: impl Fn(&Path, u64) -> bool,
    trash_one: impl Fn(&Path) -> Result<(), String>,
) -> Result<TrashDto, CmdError> {
    let plan = state.trash_plan(generation, rev, ids)?;
    for item in &plan.items {
        check(item)?;
    }
    let mut trashed = Vec::new();
    let mut gone = Vec::new();
    let mut failed = Vec::new();
    for item in &plan.items {
        if state.closing() {
            break;
        }
        let path = item.path.display().to_string();
        if !allowed(&item.path, item.size.max(item.len)) {
            failed.push(TrashFailureDto {
                path,
                error: CmdError::NoTrash,
            });
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
                gone.push(item.path.clone());
            }
            Err(os_message) => failed.push(TrashFailureDto {
                path: path.clone(),
                error: CmdError::Io { path, os_message },
            }),
        }
    }
    let mut warning = None;
    if !trashed.is_empty() {
        state.note_trashed(gone);
        let volume = sources::volume_usage(Path::new(&plan.root));
        warning = match state.remove_trashed(generation, &trashed, volume) {
            Some(tree) => jobs::save(&tree, cache_dir).err(),
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
    })
}

/// The item still is what the scan saw: the same kind, the same modification time (its own,
/// or as its folder lists it: the scan takes a folder's time from the listing).
// ponytail: an item changed after the scan whose folder listing still shows the old time
// passes; the trash can be undone and the confirmation shows the path and the scan date.
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
// the gap is short and the trash can be undone. See README, "Moving to the trash".
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

#[cfg(test)]
mod during_tests;
#[cfg(test)]
pub(crate) mod fixture;
#[cfg(test)]
mod scan_tests;
#[cfg(test)]
mod tests;
