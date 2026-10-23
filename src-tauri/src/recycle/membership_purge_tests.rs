//! Clean-up rows deleted for good on a scanned temporary "drive" (see `membership_tests`):
//! what goes, links, a stop, nested ids and a folder deleted only in part.

use std::fs;
use std::path::Path;

use super::fixture::link;
use super::membership::Disposal;
use super::membership_tests::{CACHE, NODE_MODULES, cacache, to_trash};
use super::purge;
use crate::error::CmdError;
use crate::state::cleanup_tests::machine;

#[test]
fn rows_deleted_for_good_leave_the_disk_and_the_tree() {
    let m = machine();
    let (cache, npm) = (m.path(CACHE), m.path(&cacache()));
    let before = m.tree().node(0).size;
    let size = m.size(CACHE) + m.size(&cacache());
    let done = m.delete(&[CACHE, &cacache()], Disposal::Purge).unwrap();
    assert_eq!(
        (done.removed, done.failed, done.stopped),
        (2, vec![], false)
    );
    assert!(!cache.exists() && !npm.exists());
    assert_eq!(m.tree().node(0).size, before - size);
}

#[test]
fn an_item_inside_a_row_goes_with_it() {
    let m = machine();
    let row = m.path(NODE_MODULES);
    let inside = format!("{NODE_MODULES}/pkg");
    let done = m.delete(&[NODE_MODULES, &inside], Disposal::Purge).unwrap();
    assert_eq!((done.removed, done.failed), (1, vec![]));
    assert!(!row.exists());
}

#[test]
fn a_link_inside_a_row_goes_as_a_link_and_its_target_stays() {
    let m = machine();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("keep.txt"), b"keep").unwrap();
    let row = m.path(NODE_MODULES);
    if !link(outside.path(), &row.join("pkg").join("linked")) {
        eprintln!("skipped: no directory link here");
        return;
    }
    let done = m.delete(&[NODE_MODULES], Disposal::Purge).unwrap();
    assert_eq!((done.removed, done.failed), (1, vec![]));
    assert!(!row.exists());
    assert_eq!(fs::read(outside.path().join("keep.txt")).unwrap(), b"keep");
}

#[test]
fn a_stop_between_items_leaves_the_rest() {
    let m = machine();
    let state = m.state.clone();
    let paths = [m.path(CACHE), m.path(&cacache())];
    let stop_after = |path: &Path| {
        state.stop_trash();
        purge::delete(path)
    };
    let done = m
        .delete(&[CACHE, &cacache()], to_trash(&stop_after))
        .unwrap();
    assert_eq!((done.removed, done.failed, done.stopped), (1, vec![], true));
    assert_eq!(paths.iter().filter(|p| p.exists()).count(), 1);
}

#[test]
fn a_row_deleted_only_in_part_fails_and_keeps_its_size() {
    let m = machine();
    let (cache, npm) = (m.path(CACHE), m.path(&cacache()));
    let size = m.size(CACHE);
    let Some(_hold) = undeletable(&cache) else {
        eprintln!("skipped: every file can be deleted here");
        return;
    };
    let done = m.delete(&[CACHE, &cacache()], Disposal::Purge).unwrap();
    allow_again(&cache);
    assert_eq!(done.removed, 1, "the other row goes");
    assert!(!npm.exists());
    assert_eq!(done.failed.len(), 1);
    assert_eq!(done.failed[0].path, cache.display().to_string());
    assert!(matches!(done.failed[0].error, CmdError::Io { .. }));
    assert_eq!(m.size(CACHE), size, "the tree keeps it until a refresh");
}

/// Keeps the files of the folder `dir` from being deleted until the result is dropped (Windows:
/// one held open without delete sharing) or `allow_again` (Unix: the folder read-only). `None`
/// where the system lets them go anyway (root).
#[cfg(windows)]
fn undeletable(dir: &Path) -> Option<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 1;
    let file = fs::read_dir(dir).unwrap().next()?.unwrap().path();
    fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(file)
        .ok()
}

#[cfg(windows)]
fn allow_again(_: &Path) {}

#[cfg(unix)]
fn undeletable(dir: &Path) -> Option<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o555)).unwrap();
    let probe = dir.join("probe");
    if fs::write(&probe, b"x").is_ok() {
        let _ = fs::remove_file(probe);
        allow_again(dir);
        return None;
    }
    Some(())
}

#[cfg(unix)]
fn allow_again(dir: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o755));
}
