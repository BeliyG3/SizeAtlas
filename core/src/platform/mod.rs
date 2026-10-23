//! OS-specific size measurement and traversal rules.

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

/// What a walk that deletes may do with an entry that may be a reparse point.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reparse {
    /// An ordinary file or folder.
    Plain,
    /// A symbolic link, junction or mount point: deleting it removes only the link.
    Link,
    /// Another reparse point (a cloud file, a ProjFS or deduplicated folder): it holds real
    /// content that a delete would take with it.
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
    use super::{BinSpace, bin_free, is_dataless};

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
