//! The copy that stays while its duplicates go to the trash: hashed again in full, and kept open
//! until the last copy has moved. On Windows the open file cannot be written, renamed or deleted
//! by anyone meanwhile; Unix has no such lock, so the file is compared again afterwards.

use std::fs::File;
use std::path::Path;

use super::hash::{Hash, Skip, Stamp, open_checked_with, skip_of, verify_after, whole};
use crate::platform::{Identity, open_pinned};

/// `ERROR_SHARING_VIOLATION`: another program has the file open for writing or deleting.
#[cfg(windows)]
const SHARING_VIOLATION: Option<i32> = Some(32);
#[cfg(not(windows))]
const SHARING_VIOLATION: Option<i32> = None;

/// An open file that was hashed again, with what it was when opened.
pub struct Held {
    #[cfg_attr(
        not(windows),
        allow(dead_code, reason = "Unix compares by path: nothing locks the file")
    )]
    file: File,
    stamp: Stamp,
    identity: Identity,
}

impl Held {
    pub fn identity(&self) -> Identity {
        self.identity
    }

    /// The file is still what it was when hashed. Windows: its length and time by the handle
    /// (a safety net: nobody can change it while it is held). Unix: the file at `path` is the
    /// one held (device and inode) with the same length and time.
    pub fn unchanged(&self, path: &Path) -> bool {
        #[cfg(windows)]
        {
            let _ = path;
            self.file
                .metadata()
                .is_ok_and(|meta| Stamp::of(&meta) == self.stamp)
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            std::fs::symlink_metadata(path).is_ok_and(|meta| {
                let id = crate::platform::FileId::new(meta.dev(), u128::from(meta.ino()));
                id.is_some() && id == self.identity.id && Stamp::of(&meta) == self.stamp
            })
        }
    }
}

/// [`super::hash::rehash`] that keeps the file open (`platform::open_pinned`): checked as
/// `open_checked` does before and as `verify_after` does after reading, `stop` asked before
/// every read (a stop gives `Err(Skip::Failed)`, which the caller tells apart by its own `stop`).
/// A file another program has open for writing is `Changed`: it may change at any moment.
pub fn rehash_held(
    path: &Path,
    len: u64,
    mtime: i64,
    stop: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(u64),
) -> Result<(Hash, Held), Skip> {
    let pinned = |path: &Path| {
        open_pinned(path).map_err(|e| match e.raw_os_error() {
            code if code.is_some() && code == SHARING_VIOLATION => Skip::Changed,
            _ => skip_of(&e),
        })
    };
    let (mut file, identity, stamp) = open_checked_with(path, len, mtime, pinned)?;
    let hash = whole(&mut file, stop, progress).map_err(|e| skip_of(&e))?;
    let hash = hash.ok_or(Skip::Failed)?;
    verify_after(&file, stamp)?;
    Ok((
        hash,
        Held {
            file,
            stamp,
            identity,
        },
    ))
}
