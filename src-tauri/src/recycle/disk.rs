//! What an item of a trash request is on disk now, compared with what the scan saw.

use std::fs;
use std::io;
use std::path::Path;

use sizeatlas_core::scanner::mtime_of;

use crate::error::CmdError;
use crate::state::TrashItem;

/// The item still is what the scan saw: the same kind, one of the modification `times` (its own,
/// or as its folder lists it: the scan takes a folder's time from the listing). `times` is the
/// stored time, then those that removals of this app gave a folder since
/// (`AppState::settled_times`).
// ponytail: an item changed after the scan whose folder listing still shows the old time
// passes; the trash can be undone and the confirmation shows the path and the scan date. A
// clean-up row, which may be deleted for good, does not rely on this: `recheck` walks it on
// disk right before (see `membership::run_rows`).
pub(super) fn check(item: &TrashItem, times: &[i64]) -> Result<(), CmdError> {
    match fs::symlink_metadata(&item.path) {
        Ok(meta)
            if meta.is_dir() == item.is_dir
                && times
                    .iter()
                    .any(|&time| unchanged(time, mtime_of(&meta), || listed_mtime(&item.path))) =>
        {
            Ok(())
        }
        Ok(_) => Err(CmdError::Changed),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Err(CmdError::Changed),
        Err(e) => Err(CmdError::io(&item.path, e)),
    }
}

/// Nothing is at `path` any more: an item that went meanwhile (another request took it or its
/// folder, or it was deleted outside SizeAtlas) is no error, it is gone already.
pub(super) fn gone(path: &Path) -> bool {
    fs::symlink_metadata(path).is_err_and(|e| e.kind() == io::ErrorKind::NotFound)
}

/// Whether the `stored` time of an item is the one it has: its `own` time or, only if that
/// differs, the time of its entry in the listing of its folder. On Windows the listing can lag
/// behind the item's own time, and a scan stores the listed time of a folder.
pub(super) fn unchanged(stored: i64, own: i64, listed: impl FnOnce() -> Option<i64>) -> bool {
    own == stored || listed() == Some(stored)
}

pub(super) fn modified(path: &Path) -> Option<i64> {
    fs::symlink_metadata(path).ok().map(|meta| mtime_of(&meta))
}

/// Modification time of `path` as the listing of its folder has it.
pub(super) fn listed_mtime(path: &Path) -> Option<i64> {
    let (folder, name) = (path.parent()?, path.file_name()?);
    let entry = fs::read_dir(folder)
        .ok()?
        .flatten()
        .find(|e| e.file_name() == name)?;
    entry.metadata().ok().map(|meta| mtime_of(&meta))
}
