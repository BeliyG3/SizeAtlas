use std::fs::Metadata;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use crate::tree::{SizeMode, flags};

/// The file system being scanned; directories on other devices are not entered.
pub struct Volume {
    pub cluster: u64,
    dev: u64,
    extra_dev: Option<u64>,
    skip: Option<PathBuf>,
}

impl Volume {
    pub fn of(root: &Path, meta: &Metadata) -> Volume {
        let mut volume = Volume {
            cluster: 0,
            dev: meta.dev(),
            extra_dev: None,
            skip: None,
        };
        if cfg!(target_os = "macos") && root == Path::new("/") {
            // User data lives on the Data volume and is reachable from `/` through firmlinks
            // (/Users, /Applications…). Its own mount point is skipped to avoid counting it twice.
            let data = PathBuf::from("/System/Volumes/Data");
            if let Ok(m) = std::fs::symlink_metadata(&data) {
                volume.extra_dev = Some(m.dev());
                volume.skip = Some(data);
            }
        }
        volume
    }

    pub fn allows_dir(&self, path: &Path, meta: &Metadata) -> bool {
        let same_fs = meta.dev() == self.dev || Some(meta.dev()) == self.extra_dev;
        same_fs && self.skip.as_deref() != Some(path)
    }

    pub fn size_mode(&self) -> SizeMode {
        SizeMode::Allocated
    }

    /// Allocated blocks; files that exist only in iCloud take no space.
    pub fn disk_size(&self, meta: &Metadata, _path: impl FnOnce() -> PathBuf) -> u64 {
        if cloud_only(meta) {
            return 0;
        }
        meta.blocks() * 512
    }
}

/// Directories that exist only in iCloud are not entered: listing them makes macOS download them.
pub fn dir_flags(meta: &Metadata) -> u8 {
    if cloud_only(meta) { flags::CLOUD } else { 0 }
}

#[cfg(target_os = "macos")]
fn cloud_only(meta: &Metadata) -> bool {
    use std::os::macos::fs::MetadataExt as _;
    super::is_dataless(meta.st_flags())
}

#[cfg(not(target_os = "macos"))]
fn cloud_only(_meta: &Metadata) -> bool {
    false
}

/// Makes any read of a cloud-only item by this process fail (EDEADLK) instead of downloading it.
/// The scanner never opens such items; this is a safety net, so a failure is ignored.
#[cfg(target_os = "macos")]
pub fn forbid_cloud_downloads() {
    // <sys/resource.h>; the libc crate does not expose these.
    const IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES: libc::c_int = 3;
    const IOPOL_SCOPE_PROCESS: libc::c_int = 0;
    const IOPOL_MATERIALIZE_DATALESS_FILES_OFF: libc::c_int = 1;
    unsafe extern "C" {
        fn setiopolicy_np(
            iotype: libc::c_int,
            scope: libc::c_int,
            policy: libc::c_int,
        ) -> libc::c_int;
    }
    // SAFETY: a plain system call with integer arguments.
    unsafe {
        setiopolicy_np(
            IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES,
            IOPOL_SCOPE_PROCESS,
            IOPOL_MATERIALIZE_DATALESS_FILES_OFF,
        );
    }
}

pub fn hardlink_key(meta: &Metadata) -> Option<(u64, u64)> {
    (meta.nlink() > 1).then(|| (meta.dev(), meta.ino()))
}

/// Every item may be tried: macOS and Linux have a trash per user. The `trash` crate moves an
/// item into the home trash; across devices it copies the item and then deletes the original,
/// and a failure is reported as an error per item, so nothing is deleted for good.
pub fn can_recycle(_path: &Path, _size: u64) -> bool {
    true
}

/// A symbolic link is a link; Unix has no other kind of reparse point.
pub fn reparse(meta: &Metadata, _path: &Path) -> super::Reparse {
    if meta.file_type().is_symlink() {
        super::Reparse::Link
    } else {
        super::Reparse::Plain
    }
}

/// Content that exists only in iCloud: reading it downloads it.
pub fn is_cloud(meta: &Metadata) -> bool {
    cloud_only(meta)
}

/// The device of an item: a folder on another device is a mount point.
///
/// ponytail: a bind mount of the same file system keeps the device, so it is not caught;
/// compare mount IDs (`statx` `STATX_MNT_ID`) if Linux rules ever reach such places.
pub fn device(meta: &Metadata) -> u64 {
    meta.dev()
}

/// Mount points are no links on Unix, so the re-check looks for links up to `/`.
pub fn volume_mount(_path: &Path) -> Option<PathBuf> {
    None
}

/// When the item's data or attributes last changed (ctime, ns since the Unix epoch; at or
/// before the epoch: unknown, 0), read from the item itself, never from a link's target.
pub fn change_time(path: &Path) -> std::io::Result<i64> {
    let meta = std::fs::symlink_metadata(path)?;
    let ns = meta
        .ctime()
        .saturating_mul(1_000_000_000)
        .saturating_add(meta.ctime_nsec());
    Ok(ns.max(0))
}

/// Only Windows defers file operations to a restart.
pub fn reboot_pending() -> bool {
    false
}

/// The trash of macOS and Linux has no size limit to report.
pub fn bin_space(_path: &Path) -> Option<super::BinSpace> {
    None
}
