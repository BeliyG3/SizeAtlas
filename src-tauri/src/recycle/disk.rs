//! What an item of a trash request is on disk now, compared with what the scan saw.

use std::fs;
use std::io;
use std::path::Path;

use sizeatlas_core::scanner::mtime_of;

use crate::error::CmdError;
use crate::state::TrashItem;

/// The item still is what the scan saw: the same kind, the same modification time (its own,
/// or as its folder lists it: the scan takes a folder's time from the listing).
// ponytail: an item changed after the scan whose folder listing still shows the old time
// passes; the trash can be undone and the confirmation shows the path and the scan date. A
// clean-up row, which may be deleted for good, does not rely on this: `recheck` walks it on
// disk right before (see `membership::run_rows`).
pub(super) fn check(item: &TrashItem) -> Result<(), CmdError> {
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
