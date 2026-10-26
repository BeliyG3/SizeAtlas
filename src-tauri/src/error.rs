//! Errors returned to the UI. The UI maps `code` to a translated message.

use std::io;
use std::path::Path;

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "code", rename_all_fields = "camelCase")]
pub enum CmdError {
    /// The id or generation no longer matches the open tree.
    StaleId,
    /// The app is closing.
    Busy,
    /// The item changed on disk since it was scanned.
    Changed,
    NoAccess {
        path: String,
    },
    CacheInvalid,
    /// The saved scan was written by an older version of the app.
    CacheOutdated,
    CacheNotSaved,
    /// The name was not valid Unicode, so the real path is unknown.
    LossyName,
    /// The item would be deleted for good instead of moved to the trash (no Recycle Bin on its
    /// drive, the bin turned off or too small), so it was left where it is.
    NoTrash,
    /// A clean-up delete refused the item: it holds something SizeAtlas never deletes (a never
    /// place or name, cloud content, a reparse point that is no link, a mount point, a work
    /// marker in an old Temp item), or it is no longer a row of either clean-up mode (its app
    /// runs now, a restart is pending, or it never was one).
    Protected,
    /// A trash of duplicates moved nothing: no copy would stay outside the excluded folders, or
    /// a copy to remove and the one that stays are the same file.
    LastCopy,
    /// The user declined the system prompt (the UAC prompt of a restart as administrator).
    Cancelled,
    Io {
        path: String,
        os_message: String,
    },
}

impl CmdError {
    pub fn io(path: &Path, err: io::Error) -> CmdError {
        let path = path.display().to_string();
        match err.kind() {
            io::ErrorKind::PermissionDenied => CmdError::NoAccess { path },
            _ => CmdError::Io {
                path,
                os_message: err.to_string(),
            },
        }
    }
}

/// A blocking task that could not finish (it panicked or the runtime shut down).
impl From<tauri::Error> for CmdError {
    fn from(e: tauri::Error) -> CmdError {
        CmdError::Io {
            path: String::new(),
            os_message: e.to_string(),
        }
    }
}
