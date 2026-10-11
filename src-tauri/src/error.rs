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
