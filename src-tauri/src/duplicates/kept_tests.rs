//! The copy that stays during a trash of duplicates: hashed again before anything moves, held
//! open on Windows until the last copy has moved, compared again afterwards on Unix, and the
//! roots checked again after the hash.

use super::tests::{dir_named, scanned};
use super::trash_fixture::{Dups, at, two_big, with_keep};
use crate::error::CmdError;
use crate::exit::ExitDecision;

#[test]
fn closing_the_kept_copys_root_in_the_rehash_refuses() {
    let t = Dups::new();
    let (_dirs, a, keep) = two_big(&t);
    let (state, b) = (
        t.state.clone(),
        keep.parent().unwrap().display().to_string(),
    );
    let refused = with_keep(&t, &a, &keep, move || assert!(state.close_path(&b)));
    assert_eq!(refused.err(), Some(CmdError::StaleId));
    assert!(t.logged().is_empty());
    assert!(at(&a, "x").exists() && keep.exists());
}

#[test]
fn opening_another_root_in_the_rehash_refuses() {
    let t = Dups::new();
    let (_dirs, a, keep) = two_big(&t);
    let other = dir_named("c-");
    let (state, path) = (t.state.clone(), other.path().to_owned());
    let refused = with_keep(&t, &a, &keep, move || {
        state.install_tree(scanned(&path));
    });
    assert_eq!(refused.err(), Some(CmdError::StaleId));
    assert!(t.logged().is_empty());
    assert!(at(&a, "x").exists());
}

#[test]
fn an_exit_during_the_rehash_moves_nothing() {
    let t = Dups::new();
    let (_dirs, a, keep) = two_big(&t);
    let state = t.state.clone();
    let done = with_keep(&t, &a, &keep, move || {
        assert_eq!(state.on_exit_request(), ExitDecision::PreventAndWait);
    })
    .unwrap();
    assert!(done.stopped && !done.cancelled);
    assert_eq!(done.removed, 0);
    assert!(t.logged().is_empty());
    tauri::async_runtime::block_on(t.state.wait_until_idle());
    assert_eq!(t.state.on_exit_request(), ExitDecision::Allow);
}

#[cfg(windows)]
#[test]
fn a_kept_copy_gone_online_only_is_not_read() {
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("a", 1), ("b", 1)]);
    t.find(false);
    let made = std::process::Command::new("attrib")
        .arg("+O")
        .arg(at(&a, "a"))
        .status()
        .unwrap();
    assert!(made.success());
    let refused = t.trash(1, &[at(&a, "b")]);
    assert_eq!(refused.err(), Some(CmdError::Changed));
    assert!(t.logged().is_empty());
}

#[cfg(windows)]
#[test]
fn a_kept_copy_cannot_be_written_during_the_batch() {
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("a", 1), ("b", 1)]);
    t.find(false);
    let (gate, go) = crate::recycle::fixture::gate();
    let confirmed = t.confirm(1, &[at(&a, "b")]).unwrap();
    let running = t.start(confirmed, gate.trash_one());
    assert_eq!(gate.next(), at(&a, "b"));
    let write = || std::fs::File::options().write(true).open(at(&a, "a"));
    assert!(write().is_err(), "held by the batch");
    go.send(()).unwrap();
    assert_eq!(running.join().unwrap().unwrap().removed, 1);
    assert!(write().is_ok());
}

#[cfg(windows)]
#[test]
fn a_kept_copy_open_for_writing_refuses() {
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("a", 1), ("b", 1)]);
    t.find(false);
    let writer = std::fs::File::options()
        .write(true)
        .open(at(&a, "a"))
        .unwrap();
    let refused = t.trash(1, &[at(&a, "b")]);
    drop(writer);
    assert_eq!(refused.err(), Some(CmdError::Changed));
    assert!(t.logged().is_empty());
}

#[cfg(unix)]
#[test]
fn a_kept_copy_changed_after_the_batch_warns() {
    use std::io::Write;
    let t = Dups::new();
    let (_dir, a) = t.root("a", &[("a", 1), ("b", 1)]);
    t.find(false);
    let confirmed = t.confirm(1, &[at(&a, "b")]).unwrap();
    let (log, keep) = (t.log.clone(), at(&a, "a"));
    let rewrite: crate::recycle::fixture::TrashOne = Box::new(move |path| {
        crate::recycle::fixture::logged(&log)(path)?;
        let mut file = std::fs::File::options().append(true).open(&keep).unwrap();
        file.write_all(b"more").map_err(|e| e.to_string())
    });
    let done = t.start(confirmed, rewrite).join().unwrap().unwrap();
    assert_eq!(done.warning, Some(CmdError::Changed));
    assert_eq!(done.removed, 1);
    assert!(!at(&a, "b").exists());
}
