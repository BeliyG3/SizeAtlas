//! Opening a file to hash it, and who the open file is.

use std::fs::{File, OpenOptions};
use std::io;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

use crate::platform::{FileId, Identity};

/// Opens `path` for reading; a symbolic link is refused (`ELOOP`) and a FIFO does not block.
pub fn open_for_hash(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW)
        .open(path)
}

/// The device and inode of `file`, and its number of links.
pub fn identity(file: &File) -> Identity {
    match file.metadata() {
        Ok(meta) => Identity {
            id: FileId::new(meta.dev(), u128::from(meta.ino())),
            nlink: meta.nlink(),
        },
        Err(_) => Identity {
            id: None,
            nlink: u64::MAX,
        },
    }
}
