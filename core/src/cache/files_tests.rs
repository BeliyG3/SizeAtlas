use std::fs;
use std::path::Path;

use super::*;
use crate::tree::sample_tree;

/// A sample tree told apart from the others by its scan time.
fn tree_at(scanned_at: i64) -> Tree {
    let mut tree = sample_tree();
    tree.scanned_at = scanned_at;
    tree
}

fn stamp(path: &Path) -> i64 {
    load(path).unwrap().0.scanned_at
}

fn stamps(files: &ScanFiles) -> [i64; 3] {
    [&files.current, &files.full, &files.base].map(|p| stamp(p))
}

fn bytes(files: &ScanFiles) -> [Vec<u8>; 3] {
    [&files.current, &files.full, &files.base].map(|p| fs::read(p).unwrap())
}

fn files_in(dir: &Path) -> ScanFiles {
    scan_files(dir, Path::new("/data/photos"))
}

#[test]
fn scan_files_share_a_stem_and_keep_off_the_bin_listing() {
    let files = files_in(Path::new("cache"));
    assert_eq!(
        files.current,
        cache_path(Path::new("cache"), Path::new("/data/photos"))
    );
    assert_eq!(files.full.with_extension("bin"), files.current);
    assert_eq!(files.base.with_extension("bin"), files.current);
    assert_eq!(files.full.extension().unwrap(), "full");
    assert_eq!(files.base.extension().unwrap(), "base");
}

#[test]
fn full_scan_rotates() {
    let dir = tempfile::tempdir().unwrap();
    let files = files_in(dir.path());
    save_full_scan(&tree_at(1), &files).unwrap();
    assert!(!files.base.exists());
    save_full_scan(&tree_at(2), &files).unwrap();
    assert_eq!(stamps(&files), [2, 2, 1]);
    save_full_scan(&tree_at(3), &files).unwrap();
    assert_eq!(stamps(&files), [3, 3, 2]);
    let leftovers: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
    assert_eq!(leftovers.len(), 3, "no temporary files remain");
}

#[test]
fn rotation_migrates_an_old_bin() {
    let dir = tempfile::tempdir().unwrap();
    let files = files_in(dir.path());
    save(&tree_at(1), &files.current).unwrap();
    save_full_scan(&tree_at(2), &files).unwrap();
    assert_eq!(stamps(&files), [2, 2, 1]);
}

#[test]
fn half_finished_rotation_keeps_the_baseline() {
    let dir = tempfile::tempdir().unwrap();
    let files = files_in(dir.path());
    save_full_scan(&tree_at(1), &files).unwrap();
    save_full_scan(&tree_at(2), &files).unwrap();
    // The state after `full -> base` succeeded and the new `full` never arrived,
    // while `current` was edited since.
    fs::remove_file(&files.full).unwrap();
    save(&tree_at(9), &files.current).unwrap();
    let base_before = fs::read(&files.base).unwrap();
    save_full_scan(&tree_at(3), &files).unwrap();
    assert_eq!(fs::read(&files.base).unwrap(), base_before);
    assert_eq!(stamps(&files), [3, 3, 1]);
}

#[test]
fn failed_write_keeps_old_files() {
    let dir = tempfile::tempdir().unwrap();
    let files = files_in(dir.path());
    save_full_scan(&tree_at(1), &files).unwrap();
    save_full_scan(&tree_at(2), &files).unwrap();
    let before = bytes(&files);
    // A directory where the temporary file of `full` belongs makes the second write fail.
    fs::create_dir(tmp_path(&files.full)).unwrap();
    assert!(save_full_scan(&tree_at(3), &files).is_err());
    assert_eq!(bytes(&files), before);
    assert!(!tmp_path(&files.current).exists());
}

#[test]
fn plain_save_leaves_full_and_base() {
    let dir = tempfile::tempdir().unwrap();
    let files = files_in(dir.path());
    save_full_scan(&tree_at(1), &files).unwrap();
    save_full_scan(&tree_at(2), &files).unwrap();
    save(&tree_at(3), &files.current).unwrap();
    assert_eq!(stamps(&files), [3, 2, 1]);
}

#[test]
fn remove_all_deletes_three_and_tolerates_missing_ones() {
    let dir = tempfile::tempdir().unwrap();
    let files = files_in(dir.path());
    remove_all(&files).unwrap();
    save_full_scan(&tree_at(1), &files).unwrap();
    save_full_scan(&tree_at(2), &files).unwrap();
    remove_all(&files).unwrap();
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    save_full_scan(&tree_at(3), &files).unwrap();
    fs::remove_file(&files.full).unwrap();
    remove_all(&files).unwrap();
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}
