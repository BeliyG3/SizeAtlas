//! Deleting one item for good, for "Delete permanently" in the clean-up modes.

use std::fs;
use std::path::Path;

/// Deletes the file or folder `path` for good, with the standard library only: no shell, no
/// trash. Links are never followed: a link itself (`path`, or one inside the folder: a symbolic
/// link, a junction) is removed, its target stays (`remove_dir_all` works so since Rust 1.58.1).
/// A folder deleted only in part is an error of this item; what is left stays on disk.
pub fn delete(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    let removed = if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    removed.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::delete;
    use crate::recycle::fixture::link;

    #[test]
    fn a_tree_goes_and_a_file_goes() {
        let dir = tempfile::tempdir().unwrap();
        let row = dir.path().join("cache");
        fs::create_dir_all(row.join("a/b")).unwrap();
        fs::write(row.join("a/b/f.bin"), [1u8; 100]).unwrap();
        fs::write(row.join("g.bin"), [1u8; 100]).unwrap();
        let file = dir.path().join("dump.dmp");
        fs::write(&file, b"x").unwrap();
        assert_eq!(delete(&row), Ok(()));
        assert_eq!(delete(&file), Ok(()));
        assert!(!row.exists() && !file.exists());
        assert!(delete(&row).is_err(), "gone already");
    }

    #[test]
    fn a_link_inside_goes_as_a_link_and_its_target_stays() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep.txt"), b"keep").unwrap();
        let row = dir.path().join("node_modules");
        fs::create_dir(&row).unwrap();
        if !link(&target, &row.join("linked")) {
            eprintln!("skipped: no directory link here");
            return;
        }
        assert_eq!(delete(&row), Ok(()));
        assert!(!row.exists());
        assert_eq!(fs::read(target.join("keep.txt")).unwrap(), b"keep");
    }

    #[test]
    fn a_link_given_itself_never_takes_its_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep.txt"), b"keep").unwrap();
        let row = dir.path().join("linked");
        if !link(&target, &row) {
            eprintln!("skipped: no directory link here");
            return;
        }
        // Removed as a link or refused: either way the target stays.
        let _ = delete(&row);
        assert_eq!(fs::read(target.join("keep.txt")).unwrap(), b"keep");
    }

    #[cfg(windows)]
    #[test]
    fn a_symbolic_link_inside_goes_as_a_link() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep.txt"), b"keep").unwrap();
        let row = dir.path().join("row");
        fs::create_dir(&row).unwrap();
        let (dir_link, file_link) = (row.join("dir"), row.join("file"));
        let made = std::os::windows::fs::symlink_dir(&target, &dir_link).is_ok()
            && std::os::windows::fs::symlink_file(target.join("keep.txt"), &file_link).is_ok();
        if !made {
            eprintln!("skipped: symbolic links need Developer Mode or administrator rights");
            return;
        }
        assert_eq!(delete(&row), Ok(()));
        assert!(!row.exists());
        assert_eq!(fs::read(target.join("keep.txt")).unwrap(), b"keep");
    }
}
