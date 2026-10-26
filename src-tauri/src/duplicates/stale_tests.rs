//! A trash of duplicates whose result is out of date moves nothing; an exit or a failure after
//! the first root keeps what moved; one count of progress for the whole request.

use std::fs;
use std::sync::Arc;
use std::sync::mpsc;
use std::thread;

use tauri::async_runtime::block_on;

use super::tests::{dir_named, scanned};
use super::trash_fixture::{Dups, at, progress, write};
use crate::error::CmdError;
use crate::exit::ExitDecision;
use crate::recycle::fixture::{HANG, TrashOne, gate, logged};
use crate::{sources, worker};

/// Roots `a` with `x`, `y` and `b` with `x`, all copies, searched.
fn two_roots(t: &Dups) -> (Vec<tempfile::TempDir>, String, String) {
    let (da, a) = t.root("a", &[("x", 1), ("y", 1)]);
    let (db, b) = t.root("b", &[("x", 1)]);
    t.find(false);
    (vec![da, db], a, b)
}

#[test]
fn a_stale_result_moves_nothing() {
    let t = Dups::new();
    let (dir, a) = t.root("a", &[("a", 1), ("b", 1), ("c", 1)]);
    t.find(false);
    let refs = t.refs(&[at(&a, "c")]);
    t.state.install_tree(scanned(dir.path()));
    let refused = super::trash::confirm(&t.state, 1, &refs).map(|_| ());
    assert_eq!(refused.err(), Some(CmdError::StaleId));
    assert!(t.logged().is_empty());
}

#[test]
fn a_stale_second_root_moves_nothing() {
    let t = Dups::new();
    let (dirs, a, _) = two_roots(&t);
    t.state.install_tree(scanned(dirs[1].path()));
    assert_eq!(t.trash(1, &[at(&a, "x")]).err(), Some(CmdError::StaleId));
    assert!(t.logged().is_empty());
}

#[test]
fn closing_a_root_moves_nothing() {
    let t = Dups::new();
    let (_dirs, a, b) = two_roots(&t);
    assert!(t.state.close_path(&b));
    assert_eq!(t.trash(1, &[at(&a, "y")]).err(), Some(CmdError::StaleId));
    assert!(t.logged().is_empty());
}

#[test]
fn opening_another_root_moves_nothing() {
    let t = Dups::new();
    let (_dirs, a, _) = two_roots(&t);
    let other = dir_named("c-");
    t.open(other.path());
    assert_eq!(t.trash(1, &[at(&a, "y")]).err(), Some(CmdError::StaleId));
    assert!(t.logged().is_empty());
}

#[test]
fn a_folder_refresh_moves_nothing() {
    let t = Dups::new();
    let (dir, a) = t.root("a", &[("x", 1), ("y", 1), ("sub/z", 2)]);
    t.find(false);
    write(dir.path(), &[("sub/new", 3)]);
    let (generation, tree) = t.state.root_tree(&a).unwrap();
    let sub = tree.find_path(&at(&a, "sub")).unwrap();
    drop(tree);
    let (of, folder) = t.state.refresh_target(generation, sub).unwrap();
    let job = t.state.enqueue_folder(of, folder).unwrap().expect("idle");
    let cache = t.cache.path().to_owned();
    block_on(worker::run(t.state.clone(), cache, job, Arc::new(|_| ())));
    assert_eq!(t.trash(1, &[at(&a, "y")]).err(), Some(CmdError::StaleId));
    assert!(t.logged().is_empty());
}

#[test]
fn no_trash_while_searching() {
    let t = Dups::new();
    let (_dirs, a, _) = two_roots(&t);
    t.state.set_running_for_test(true);
    assert_eq!(t.trash(1, &[at(&a, "y")]).err(), Some(CmdError::Busy));
    assert_eq!(t.trashing(), 0);
}

#[test]
fn a_refused_confirm_leaves_trashing_at_zero() {
    let t = Dups::new();
    let (_dirs, a, _) = two_roots(&t);
    assert_eq!(t.state.on_exit_request(), ExitDecision::Allow);
    let (state, refs) = (t.state.clone(), t.refs(&[at(&a, "y")]));
    let (sent, got) = mpsc::channel();
    thread::spawn(move || {
        let refused = super::trash::confirm(&state, 1, &refs).map(|_| ());
        sent.send(refused).unwrap();
    });
    assert_eq!(got.recv_timeout(HANG).unwrap(), Err(CmdError::Busy));
    assert_eq!(t.trashing(), 0);
    assert!(!t.state.trash_pending(&a));
}

#[test]
fn an_exit_between_two_roots_keeps_what_moved() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x1", 1), ("x2", 1)]);
    let (_db, b) = t.root("b", &[("x3", 1), ("k", 1)]);
    t.find(false);
    let generation = t.state.root_tree(&a).unwrap().0;
    let confirmed = (t.confirm(1, &[at(&a, "x1"), at(&a, "x2"), at(&b, "x3")])).unwrap();
    let (state, log, last) = (t.state.clone(), t.log.clone(), at(&a, "x2"));
    let exit: TrashOne = Box::new(move |path| {
        logged(&log)(path)?;
        if path == last {
            assert_eq!(state.on_exit_request(), ExitDecision::PreventAndWait);
        }
        Ok(())
    });
    let done = t.start(confirmed, exit).join().unwrap().unwrap();
    assert_eq!((done.removed, done.stopped), (2, true));
    assert!(at(&b, "x3").exists());
    let copies = &t.groups()[0];
    assert_eq!(copies.len(), 2, "x1 and x2 left the group");
    assert_eq!(
        t.state.root_tree(&a).unwrap().0,
        generation,
        "not compacted"
    );
    let saved = sources::cached_scans(t.cache.path());
    assert!(
        saved.iter().any(|s| s.root == a),
        "the first root was saved"
    );
    block_on(t.state.wait_until_idle());
}

#[test]
fn two_roots_report_one_progress_sequence() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x1", 1), ("x2", 1), ("k", 1)]);
    let (_db, b) = t.root("b", &[("x3", 1), ("x4", 1), ("x5", 1)]);
    t.find(false);
    let paths = [
        at(&a, "x1"),
        at(&a, "x2"),
        at(&b, "x3"),
        at(&b, "x4"),
        at(&b, "x5"),
    ];
    let confirmed = t.confirm(1, &paths).unwrap();
    let (events, report) = progress();
    let done = t.start_reporting(confirmed, logged(&t.log), report);
    assert_eq!(done.join().unwrap().unwrap().removed, 5);
    let events = events.lock().unwrap();
    let keep = at(&a, "k").display().to_string();
    assert_eq!(
        (events[0].done, events[0].current.as_deref()),
        (0, Some(keep.as_str()))
    );
    assert!(events.iter().all(|e| e.total == 5));
    assert!(events.windows(2).all(|w| w[0].done <= w[1].done));
    let ends: Vec<_> = events.iter().filter(|e| e.current.is_none()).collect();
    assert_eq!(ends.len(), 1);
    assert_eq!(events.last(), Some(ends[0]));
    assert_eq!(ends[0].done, 5);
}

#[test]
fn a_second_root_failing_after_the_first_moved_is_reported_in_failed() {
    let t = Dups::new();
    let (_dirs, a, b) = two_roots(&t);
    let confirmed = t.confirm(1, &[at(&a, "x"), at(&b, "x")]).unwrap();
    let (gate, go) = gate();
    let running = t.start(confirmed, gate.trash_one());
    assert_eq!(gate.next(), at(&a, "x"));
    // Past every check of the batch: the copy of `b` changes before its turn.
    fs::write(at(&b, "x"), b"rewritten").unwrap();
    drop(go);
    let done = running.join().unwrap().unwrap();
    assert_eq!(done.removed, 1);
    assert_eq!(done.failed.len(), 1);
    assert_eq!(done.failed[0].path, at(&b, "x").display().to_string());
    assert_eq!(gate.log(), [at(&a, "x")]);
}
