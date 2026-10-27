//! OS-specific size measurement and traversal rules.

use std::path::Path;

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

mod priority;
pub(crate) use priority::lower_this_thread;

/// The identity of a file within its volume: Windows the volume serial number and the 128-bit
/// file id, Unix the device and the inode.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FileId {
    pub volume: u64,
    pub file: u128,
}

impl FileId {
    /// `None` for the id 0, which the system gives when it has none.
    pub fn new(volume: u64, file: u128) -> Option<FileId> {
        (file != 0).then_some(FileId { volume, file })
    }
}

/// Who an open file is: its id (`None` when it could not be read) and its number of links
/// (`u64::MAX` when unknown, so that it counts as linked from elsewhere).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Identity {
    pub id: Option<FileId>,
    pub nlink: u64,
}

/// What a walk that deletes may do with an entry that may be a reparse point.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reparse {
    /// An ordinary file or folder.
    Plain,
    /// A symbolic link, junction or mount point: deleting it removes only the link.
    Link,
    /// Another reparse point (a cloud file, a ProjFS or deduplicated folder): it holds real
    /// content that a delete would take with it.
    #[cfg_attr(
        not(windows),
        allow(dead_code, reason = "only Windows has reparse points other than links")
    )]
    Other,
}

/// The Recycle Bin of a volume: its effective capacity and the bytes it holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BinSpace {
    pub capacity: u64,
    pub used: u64,
}

/// Room left in the bin; beyond it Windows deletes its oldest items for good.
pub fn bin_free(space: BinSpace) -> u64 {
    space.capacity.saturating_sub(space.used)
}

/// A key shared by every path of one volume, `None` when it cannot be told (the path is
/// gone, or the system does not say). Windows: the folder where the volume is mounted (`C:\`,
/// a mounted folder, `\\server\share\`); Unix: the device of the path (macOS `/`: of the Data volume, see `unix::volume_dev`).
pub fn volume_key(path: &Path) -> Option<String> {
    #[cfg(windows)]
    return volume_mount(path).map(|mount| mount.to_string_lossy().into_owned());
    #[cfg(unix)]
    return unix::volume_dev(path).map(|dev| format!("dev:{dev}"));
}

/// macOS `SF_DATALESS` (`<sys/stat.h>`): the item's content lives only in the cloud (iCloud
/// Drive), and reading or listing it makes macOS download it. Reading the flag downloads nothing.
const SF_DATALESS: u32 = 0x4000_0000;

/// Whether macOS `st_flags` mark a cloud-only item. Kept OS-independent so it is tested everywhere.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_dataless(st_flags: u32) -> bool {
    st_flags & SF_DATALESS != 0
}

#[cfg(test)]
mod tests {
    use super::{BinSpace, bin_free, is_dataless, volume_key};

    #[test]
    fn volume_key_is_shared_by_folders_of_one_volume() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        let key = volume_key(&a);
        assert!(key.is_some());
        assert_eq!(key, volume_key(&b));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_root_and_users_share_a_volume_key() {
        let key = |path: &str| volume_key(std::path::Path::new(path));
        assert!(key("/").is_some());
        assert_eq!(key("/"), key("/Users"));
    }

    #[cfg(windows)]
    #[test]
    fn the_volume_key_of_a_windows_folder_is_its_drive() {
        let windows = std::path::Path::new(r"C:\Windows");
        assert_eq!(volume_key(windows), Some(r"C:\".into()));
    }

    #[test]
    fn the_free_room_of_a_bin_is_never_below_zero() {
        let space = |capacity, used| bin_free(BinSpace { capacity, used });
        assert_eq!(space(100, 30), 70);
        assert_eq!(space(100, 100), 0);
        assert_eq!(space(100, 130), 0, "a bin over its limit");
    }

    #[test]
    fn only_the_dataless_flag_marks_a_cloud_only_item() {
        assert!(is_dataless(0x4000_0000));
        assert!(is_dataless(0x4000_0020), "dataless and compressed");
        assert!(!is_dataless(0));
        assert!(!is_dataless(0x0000_0020), "UF_COMPRESSED alone");
        assert!(!is_dataless(0x8000_0000), "UF_HIDDEN alone");
    }
}
