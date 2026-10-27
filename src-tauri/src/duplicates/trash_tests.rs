//! The rules of the trash of duplicates on real files: one copy always stays, what may not go
//! never goes, what left the disk leaves the result. Items go through stand-ins of the trash.

use std::fs;
use std::path::Path;
#[cfg(unix)]
use std::path::PathBuf;

use super::trash_fixture::{Dups, at, time, write};
use crate::error::CmdError;
use crate::recycle::fixture::logged;

#[test]
fn trashing_one_copy_edits_the_group_in_place() {
    let t = Dups::new();
    let (_a, a) = t.root("a", &[("a", 1), ("b", 1), ("c", 1)]);
    t.find(false);
    let before = t.dto();
    let done = t.trash(1, &[at(&a, "c")]).unwrap();
    assert_eq!((done.removed, done.gone), (1, 0));
    let after = t.dto();
    assert!(!after.stale);
    assert!(after.version > before.version);
    assert_eq!(after.groups[0].copies.len(), 2);
    let key = after.groups[0].key.clone();
    t.trash(2, &[at(&a, "b")]).unwrap();
    assert!(t.dto().groups.is_empty());
    let since = t.state.duplicates_since(after.job, after.version);
    assert_eq!(since.removed, [key]);
    assert_eq!(t.logged(), [at(&a, "c"), at(&a, "b")]);
}

#[test]
fn a_request_covering_the_whole_group_moves_nothing() {
    let t = Dups::new();
    let (_a, a) = t.root("a", &[("a", 1), ("b", 1)]);
    t.find(false);
    let refused = t.trash(1, &[at(&a, "a"), at(&a, "b")]);
    assert_eq!(refused.err(), Some(CmdError::LastCopy));
    assert!(t.logged().is_empty());
    assert!(!t.state.trash_pending(&a));
    assert_eq!(t.trashing(), 0);
}

#[test]
fn the_last_user_copy_next_to_a_program_files_copy_stays() {
    let t = Dups::new();
    let (dir, a) = t.root("a", &[("Program Files/x", 1), ("Pictures/x", 1)]);
    let _ = dir;
    t.programs_at(&at(&a, "Program Files"));
    t.find(true);
    assert_eq!(t.groups()[0].len(), 2, "the zone copy is in the group");
    let refused = t.trash(1, &[at(&a, "Pictures/x")]);
    assert_eq!(refused.err(), Some(CmdError::LastCopy));
    assert!(t.logged().is_empty());
}

#[test]
fn a_copy_in_a_zone_is_never_moved() {
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("Program Files/x", 1), ("Pictures/x", 1)]);
    t.programs_at(&at(&a, "Program Files"));
    t.find(true);
    let refused = t.trash(1, &[at(&a, "Program Files/x")]);
    assert_eq!(refused.err(), Some(CmdError::Protected));
    assert!(t.logged().is_empty());
}

#[test]
fn a_kept_copy_rewritten_with_its_old_time_refuses() {
    let t = Dups::new();
    let (dir, a) = t.root("a", &[("a", 1), ("b", 1)]);
    t.find(false);
    // The same length and time, other bytes: only the hash tells.
    write(dir.path(), &[("a", 2)]);
    let refused = t.trash(1, &[at(&a, "b")]);
    assert_eq!(refused.err(), Some(CmdError::Changed));
    assert!(at(&a, "b").exists());
    assert!(t.logged().is_empty());
    assert!(t.dto().groups[0].stale);
}

#[test]
fn a_group_marked_stale_refuses_another_kept_copy() {
    let t = Dups::new();
    let (dir, a) = t.root("a", &[("a", 1), ("b", 1), ("c", 1)]);
    t.find(false);
    write(dir.path(), &[("a", 2)]);
    assert_eq!(t.trash(1, &[at(&a, "b")]).err(), Some(CmdError::Changed));
    // `c` would stay and still match, but `a` is no copy any more.
    let refused = t.trash(2, &[at(&a, "a"), at(&a, "b")]);
    assert_eq!(refused.err(), Some(CmdError::StaleId));
    assert!(t.logged().is_empty());
}

#[test]
fn the_same_file_on_both_sides_refuses() {
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("a", 1), ("b", 1), ("c", 1)]);
    t.find(false);
    fs::remove_file(at(&a, "b")).unwrap();
    fs::hard_link(at(&a, "a"), at(&a, "b")).unwrap();
    let b = fs::symlink_metadata(at(&a, "b")).unwrap();
    assert_eq!((b.len(), b.modified().unwrap()), (8192, time()));
    // `a` is the only copy left outside the request: it stays, and `b` is `a` now.
    let confirmed = t.confirm(1, &[at(&a, "b"), at(&a, "c")]).unwrap();
    let refused = t.start(confirmed, logged(&t.log)).join().unwrap();
    assert_eq!(refused.err(), Some(CmdError::LastCopy));
    assert!(t.logged().is_empty());
}

#[test]
fn a_volume_without_a_trash_refuses_each_copy() {
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("a", 1), ("b", 1)]);
    t.find(false);
    let confirmed = t.confirm(1, &[at(&a, "b")]).unwrap();
    let (state, cache) = (t.state.clone(), t.cache.path().to_owned());
    let done = tauri::async_runtime::block_on(super::trash::run(
        &state,
        cache,
        confirmed,
        |_, _| false,
        logged(&t.log),
        |_| (),
    ))
    .unwrap();
    assert_eq!(done.removed, 0);
    assert_eq!(done.failed[0].error, CmdError::NoTrash);
    assert!(t.logged().is_empty());
}

#[test]
fn a_hard_linked_copy_goes_with_all_its_paths() {
    let t = Dups::new();
    let dir = super::tests::dir_named("a-");
    write(dir.path(), &[("A", 1), ("C", 1)]);
    fs::hard_link(dir.path().join("A"), dir.path().join("B")).unwrap();
    let a = t.open(dir.path());
    t.find(false);
    assert_eq!(t.groups()[0].len(), 2, "A and B are one copy");
    let done = t.trash(1, &[at(&a, "A")]).unwrap();
    assert_eq!(done.removed, 2);
    let mut log = t.logged();
    log.sort();
    assert_eq!(log, [at(&a, "A"), at(&a, "B")]);
    assert!(at(&a, "C").exists());
}

#[test]
fn trashing_two_copies_of_one_root_keeps_the_result_fresh() {
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("a", 1), ("b", 1), ("c", 1), ("d", 1)]);
    t.find(false);
    assert_eq!(t.trash(1, &[at(&a, "c"), at(&a, "d")]).unwrap().removed, 2);
    assert!(!t.dto().stale);
    assert_eq!(t.trash(2, &[at(&a, "b")]).unwrap().removed, 1);
}

#[test]
fn a_hard_linked_object_keeps_the_result_fresh() {
    let t = Dups::new();
    let dir = super::tests::dir_named("a-");
    write(dir.path(), &[("A", 1), ("C", 1), ("D", 1)]);
    fs::hard_link(dir.path().join("A"), dir.path().join("B")).unwrap();
    let a = t.open(dir.path());
    t.find(false);
    assert_eq!(t.trash(1, &[at(&a, "A")]).unwrap().removed, 2);
    assert!(!t.dto().stale);
    assert_eq!(t.trash(2, &[at(&a, "C")]).unwrap().removed, 1);
}

#[test]
fn a_copy_gone_meanwhile_leaves_the_group() {
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("a", 1), ("b", 1), ("c", 1)]);
    t.find(false);
    fs::remove_file(at(&a, "c")).unwrap();
    let done = t.trash(1, &[at(&a, "c")]).unwrap();
    assert_eq!((done.removed, done.gone), (0, 1));
    assert!(t.logged().is_empty());
    let c = at(&a, "c").display().to_string();
    assert!(!t.groups()[0].contains(&c));
    assert!(!t.dto().stale);
}

#[test]
fn a_path_that_cannot_be_checked_is_not_gone() {
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("a", 1), ("sub/c", 1)]);
    t.find(false);
    let c = at(&a, "sub/c");
    let blocked = Blocked::new(&c);
    let refused = t.trash(1, std::slice::from_ref(&c));
    drop(blocked);
    assert!(
        matches!(refused, Err(CmdError::NoAccess { .. })),
        "{refused:?}"
    );
    assert!(t.logged().is_empty());
    assert!(t.groups()[0].contains(&c.display().to_string()));
}

/// Keeps `path` from being read until dropped: Unix takes the rights of its folder, Windows
/// holds the file open with no sharing.
#[cfg(unix)]
struct Blocked(PathBuf);
#[cfg(windows)]
struct Blocked(#[expect(dead_code, reason = "held until dropped")] fs::File);

impl Blocked {
    #[cfg(unix)]
    fn new(path: &Path) -> Blocked {
        use std::os::unix::fs::PermissionsExt;
        let folder = path.parent().unwrap().to_owned();
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o000)).unwrap();
        Blocked(folder)
    }

    #[cfg(windows)]
    fn new(path: &Path) -> Blocked {
        use std::os::windows::fs::OpenOptionsExt;
        let file = fs::File::options().read(true).share_mode(0).open(path);
        Blocked(file.unwrap())
    }
}

#[cfg(unix)]
impl Drop for Blocked {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o755));
    }
}

#[test]
fn a_path_recreated_after_the_move_leaves_the_group() {
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("a", 1), ("b", 1), ("c", 1)]);
    t.find(false);
    let confirmed = t.confirm(1, &[at(&a, "c")]).unwrap();
    let log = t.log.clone();
    let recreate: crate::recycle::fixture::TrashOne = Box::new(move |path| {
        logged(&log)(path)?;
        fs::write(path, b"another file").map_err(|e| e.to_string())
    });
    let done = t.start(confirmed, recreate).join().unwrap().unwrap();
    assert_eq!(done.removed, 1);
    assert!(at(&a, "c").exists());
    let c = at(&a, "c").display().to_string();
    assert!(!t.groups()[0].contains(&c));
}
