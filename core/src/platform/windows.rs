use std::fs::Metadata;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::path::{Component, Path, PathBuf, Prefix};

use windows_sys::Win32::Foundation::{GetLastError, INVALID_HANDLE_VALUE, NO_ERROR};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_COMPRESSED, FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
    FILE_ATTRIBUTE_RECALL_ON_OPEN, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_SPARSE_FILE,
    FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, GetCompressedFileSizeW,
    GetDiskFreeSpaceW, GetVolumePathNameW, INVALID_FILE_SIZE, WIN32_FIND_DATAW,
};

use crate::tree::{SizeMode, flags};

mod item;
mod reboot;
mod recycle_bin;
mod registry;

#[cfg(test)]
pub use item::tag_for_test;
pub use item::{change_time, device, is_cloud, is_foreign, reparse, volume_mount};
pub use reboot::reboot_pending;
pub use recycle_bin::{bin_space, can_recycle};

/// Reparse tags of Windows Container Isolation (Windows Sandbox, Docker). Container layers
/// are virtual views of system files: listing them goes through a filter driver (about 5×
/// slower scan of a system drive) and their files would be counted a second time.
const IO_REPARSE_TAG_WCI: u32 = 0x8000_0018;
const IO_REPARSE_TAG_WCI_1: u32 = 0x9000_1018;

/// The volume being scanned. Volume mount points inside it are reparse points,
/// which the scanner already skips as symlinks; container layers are skipped here.
pub struct Volume {
    pub cluster: u64,
}

impl Volume {
    pub fn of(root: &Path, _meta: &Metadata) -> Volume {
        Volume {
            cluster: cluster_size(root).unwrap_or(0),
        }
    }

    pub fn allows_dir(&self, path: &Path, meta: &Metadata) -> bool {
        meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
            || !reparse_tag(path).is_some_and(is_container_layer)
    }

    pub fn size_mode(&self) -> SizeMode {
        if self.cluster > 0 {
            SizeMode::ClusterEstimate
        } else {
            SizeMode::Logical
        }
    }

    /// Size on disk: whole clusters; compressed and sparse files use their allocated size;
    /// cloud-only placeholders take no space.
    pub fn disk_size(&self, meta: &Metadata, path: impl FnOnce() -> PathBuf) -> u64 {
        let attributes = meta.file_attributes();
        if attributes & (FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_OFFLINE) != 0 {
            return 0;
        }
        let len = if attributes & (FILE_ATTRIBUTE_COMPRESSED | FILE_ATTRIBUTE_SPARSE_FILE) != 0 {
            compressed_size(&path()).unwrap_or(meta.len())
        } else {
            meta.len()
        };
        if self.cluster == 0 {
            len
        } else {
            len.div_ceil(self.cluster) * self.cluster
        }
    }
}

/// Directories that exist only in the cloud are not entered: listing them makes
/// OneDrive download their contents.
pub fn dir_flags(meta: &Metadata) -> u8 {
    if meta.file_attributes() & FILE_ATTRIBUTE_RECALL_ON_OPEN != 0 {
        flags::CLOUD
    } else {
        0
    }
}

/// Hard links are not detected on Windows: it would require opening every file.
pub fn hardlink_key(_meta: &Metadata) -> Option<(u64, u64)> {
    None
}

fn is_container_layer(tag: u32) -> bool {
    matches!(tag, IO_REPARSE_TAG_WCI | IO_REPARSE_TAG_WCI_1)
}

/// Reparse tag of a directory entry, read from its own find data (no handle is opened).
/// Called only for reparse-point directories, so the extra system call is rare.
fn reparse_tag(path: &Path) -> Option<u32> {
    let wide = wide_long(path);
    // SAFETY: an all-zero WIN32_FIND_DATAW is a valid value.
    let mut data: WIN32_FIND_DATAW = unsafe { std::mem::zeroed() };
    // SAFETY: `wide` is NUL-terminated and `data` is a valid out-buffer for FindExInfoBasic.
    let handle = unsafe {
        FindFirstFileExW(
            wide.as_ptr(),
            FindExInfoBasic,
            (&raw mut data).cast(),
            FindExSearchNameMatch,
            std::ptr::null(),
            0,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return None;
    }
    // SAFETY: `handle` was returned by a successful FindFirstFileExW.
    unsafe { FindClose(handle) };
    Some(data.dwReserved0)
}

/// Bytes actually allocated for a compressed or sparse file.
fn compressed_size(path: &Path) -> Option<u64> {
    let wide = wide_nul(path);
    let mut high = 0u32;
    // SAFETY: `wide` is NUL-terminated and `high` is a valid out-pointer.
    let low = unsafe { GetCompressedFileSizeW(wide.as_ptr(), &mut high) };
    // SAFETY: plain thread-local error query.
    if low == INVALID_FILE_SIZE && unsafe { GetLastError() } != NO_ERROR {
        return None;
    }
    Some((u64::from(high) << 32) | u64::from(low))
}

fn wide_nul(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

/// `path` NUL-terminated, in the `\\?\` form when it is absolute, so that it may pass the old
/// limit of 260 characters, as std does for its own calls.
fn wide_long(path: &Path) -> Vec<u16> {
    let parent = path.components().any(|c| c == Component::ParentDir);
    let (head, skip) = match path.components().next() {
        Some(Component::Prefix(p)) if !parent && path.has_root() => match p.kind() {
            Prefix::Disk(_) => (r"\\?\", 0),
            Prefix::UNC(..) => (r"\\?\UNC\", 2),
            _ => ("", 0),
        },
        _ => ("", 0),
    };
    let slash = u16::from(b'/');
    let body = path.as_os_str().encode_wide().skip(skip);
    let body = body.map(|c| if c == slash { u16::from(b'\\') } else { c });
    head.encode_utf16().chain(body).chain(Some(0)).collect()
}

/// The mount point of the volume of `path` (`C:\` or a mounted folder), NUL-terminated.
fn volume_root(path: &Path) -> Option<Vec<u16>> {
    let wide = wide_nul(path);
    let mut root = vec![0u16; 1024];
    // SAFETY: `wide` is NUL-terminated and `root` has the capacity we pass.
    if unsafe { GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), root.len() as u32) } == 0 {
        return None;
    }
    let end = root.iter().position(|&c| c == 0)?;
    root.truncate(end + 1);
    Some(root)
}

fn cluster_size(path: &Path) -> Option<u64> {
    let wide = wide_nul(path);
    let mut volume = [0u16; 1024];
    // SAFETY: `wide` is NUL-terminated and `volume` has the capacity we pass.
    if unsafe { GetVolumePathNameW(wide.as_ptr(), volume.as_mut_ptr(), volume.len() as u32) } == 0 {
        return None;
    }
    let (mut sectors, mut bytes, mut free, mut total) = (0u32, 0u32, 0u32, 0u32);
    // SAFETY: `volume` was NUL-terminated by the previous call; all out-pointers are valid.
    if unsafe {
        GetDiskFreeSpaceW(
            volume.as_ptr(),
            &mut sectors,
            &mut bytes,
            &mut free,
            &mut total,
        )
    } == 0
    {
        return None;
    }
    let cluster = u64::from(sectors) * u64::from(bytes);
    (cluster > 0).then_some(cluster)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_container_layer_tags_are_skipped() {
        assert!(is_container_layer(0x8000_0018));
        assert!(is_container_layer(0x9000_1018));
        assert!(
            !is_container_layer(0x9000_301A),
            "cloud files must still be scanned"
        );
        assert!(!is_container_layer(0xA000_0003), "mount point / junction");
        assert!(!is_container_layer(0xA000_000C), "symlink");
    }

    #[test]
    fn absolute_paths_are_opened_in_the_long_form() {
        let long = |p: &str| String::from_utf16(&wide_long(Path::new(p))).unwrap();
        assert_eq!(long(r"C:\a/b"), "\\\\?\\C:\\a\\b\0");
        assert_eq!(long(r"\\srv\share\x"), "\\\\?\\UNC\\srv\\share\\x\0");
        assert_eq!(long(r"\\?\C:\x"), "\\\\?\\C:\\x\0");
        assert_eq!(long(r"rel\x"), "rel\\x\0");
        assert_eq!(long(r"C:\a\..\b"), "C:\\a\\..\\b\0", "left to the system");
    }

    #[test]
    fn reparse_tag_reads_the_tag_of_a_junction() {
        let target = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let link = dir.path().join("junction");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(target.path())
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(reparse_tag(&link), Some(0xA000_0003));
        assert_eq!(reparse_tag(&dir.path().join("missing")), None);
    }
}
