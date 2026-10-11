//! OS-specific size measurement and traversal rules.

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

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
    use super::is_dataless;

    #[test]
    fn only_the_dataless_flag_marks_a_cloud_only_item() {
        assert!(is_dataless(0x4000_0000));
        assert!(is_dataless(0x4000_0020), "dataless and compressed");
        assert!(!is_dataless(0));
        assert!(!is_dataless(0x0000_0020), "UF_COMPRESSED alone");
        assert!(!is_dataless(0x8000_0000), "UF_HIDDEN alone");
    }
}
