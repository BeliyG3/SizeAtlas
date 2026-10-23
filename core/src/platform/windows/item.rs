//! What the re-check before deleting reads of one item: its kind of reparse point, cloud state,
//! change time and volume.

use std::fs::Metadata;
use std::io;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};

use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
    FILE_ATTRIBUTE_RECALL_ON_OPEN, FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FileBasicInfo,
    GetFileInformationByHandleEx, OPEN_EXISTING,
};

use super::{reparse_tag, volume_root, wide_long};
use crate::platform::Reparse;

/// Junctions and volume mount points share this tag.
const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;
const IO_REPARSE_TAG_SYMLINK: u32 = 0xA000_000C;

/// What a reparse point at `path` is. Only symbolic links, junctions and mount points are
/// links, whose deletion removes the link alone; a cloud file, a ProjFS or deduplicated folder
/// keeps real content that a delete would take with it.
pub fn reparse(meta: &Metadata, path: &Path) -> Reparse {
    let attributes = meta.file_attributes();
    let tag = if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        reparse_tag(path)
    } else {
        None
    };
    reparse_of(attributes, tag)
}

/// [`reparse`] from the attributes and the tag (`None` when it could not be read).
fn reparse_of(attributes: u32, tag: Option<u32>) -> Reparse {
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
        Reparse::Plain
    } else if matches!(
        tag,
        Some(IO_REPARSE_TAG_MOUNT_POINT | IO_REPARSE_TAG_SYMLINK)
    ) {
        Reparse::Link
    } else {
        Reparse::Other
    }
}

/// Content kept elsewhere (cloud placeholders, offline storage): opening or reading it fetches
/// it.
pub fn is_cloud(meta: &Metadata) -> bool {
    const ELSEWHERE: u32 = FILE_ATTRIBUTE_RECALL_ON_OPEN
        | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
        | FILE_ATTRIBUTE_OFFLINE;
    meta.file_attributes() & ELSEWHERE != 0
}

/// The device of an item, to notice mount points that are no links. Windows mount points are
/// reparse points, so every item counts as on one device.
pub fn device(_meta: &Metadata) -> u64 {
    0
}

/// The folder where the volume of `path` is mounted (`C:\`, or a mounted folder); the re-check
/// looks for links below it only.
pub fn volume_mount(path: &Path) -> Option<PathBuf> {
    let root = volume_root(path)?;
    Some(PathBuf::from(String::from_utf16_lossy(
        &root[..root.len() - 1],
    )))
}

/// When the item's data or attributes last changed (ns since the Unix epoch, 0 if unknown),
/// read from the item itself, never from a link's target.
pub fn change_time(path: &Path) -> io::Result<i64> {
    let wide = wide_long(path);
    // SAFETY: `wide` is NUL-terminated; no security attributes and no template are passed.
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: an all-zero FILE_BASIC_INFO is a valid value.
    let mut info: FILE_BASIC_INFO = unsafe { std::mem::zeroed() };
    // SAFETY: `handle` is open and `info` is a valid out-buffer of the size passed.
    let read = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileBasicInfo,
            (&raw mut info).cast(),
            size_of::<FILE_BASIC_INFO>() as u32,
        )
    };
    let error = (read == 0).then(io::Error::last_os_error);
    // SAFETY: `handle` was opened above and is closed once, before anything else can fail.
    unsafe { CloseHandle(handle) };
    match error {
        Some(error) => Err(error),
        None => Ok(filetime_ns(info.ChangeTime)),
    }
}

/// A FILETIME (100 ns ticks since 1601) as ns since the Unix epoch. A time at or before the
/// epoch (0 = never set, the 1601 of a cleared time) is unknown: 0.
fn filetime_ns(ticks: i64) -> i64 {
    const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;
    let ns = ticks.saturating_sub(UNIX_EPOCH_TICKS).saturating_mul(100);
    ns.max(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_DIRECTORY;

    #[test]
    fn only_links_are_leaves_and_other_reparse_points_are_refused() {
        const DIR: u32 = FILE_ATTRIBUTE_DIRECTORY;
        const REPARSE: u32 = FILE_ATTRIBUTE_REPARSE_POINT;
        assert_eq!(reparse_of(DIR, None), Reparse::Plain);
        assert_eq!(reparse_of(0, None), Reparse::Plain);
        let junction = reparse_of(DIR | REPARSE, Some(0xA000_0003));
        assert_eq!(junction, Reparse::Link, "junction or mount point");
        assert_eq!(reparse_of(REPARSE, Some(0xA000_000C)), Reparse::Link);
        for tag in [
            0x9000_001A, // cloud files (hydrated or pinned: no recall attribute)
            0x9000_101A, // cloud files, another variant
            0x9000_001C, // ProjFS / VFS for Git
            0x8000_0013, // deduplication
            0x8000_0018, // container isolation
            0xA000_001D, // WSL symbolic link: a name surrogate std treats as a link
        ] {
            let other = reparse_of(DIR | REPARSE, Some(tag));
            assert_eq!(other, Reparse::Other, "{tag:#x}");
        }
        assert_eq!(
            reparse_of(DIR | REPARSE, None),
            Reparse::Other,
            "tag unread"
        );
    }

    #[test]
    fn file_times_at_or_before_the_epoch_are_unknown() {
        assert_eq!(filetime_ns(0), 0);
        assert_eq!(filetime_ns(116_444_736_000_000_000), 0);
        assert_eq!(filetime_ns(116_444_736_000_000_001), 100);
        assert_eq!(filetime_ns(116_444_735_999_999_999), 0);
        assert_eq!(filetime_ns(i64::MIN), 0, "no overflow");
        assert_eq!(filetime_ns(i64::MAX), i64::MAX);
    }

    #[test]
    fn a_junction_is_a_link_and_a_folder_is_plain() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        std::fs::create_dir(&target).unwrap();
        let meta = std::fs::symlink_metadata(&target).unwrap();
        assert_eq!(reparse(&meta, &target), Reparse::Plain);
        let link = dir.path().join("junction");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .output()
            .is_ok_and(|out| out.status.success());
        if made {
            let meta = std::fs::symlink_metadata(&link).unwrap();
            assert_eq!(reparse(&meta, &link), Reparse::Link);
        }
    }
}
