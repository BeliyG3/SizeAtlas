//! The compaction a root's trash requests defer to the end of the last one: after it ran, after
//! its plan was refused, never while the app closes and never waiting for nothing.

use std::sync::mpsc;
use std::thread;

use super::fixture::{HANG, Log, confirm, done, gate, logged, open, real, refuse, root_of, start};
use crate::error::CmdError;
use crate::exit::ExitDecision;
use crate::state::AppState;

#[test]
fn compaction_waits_for_the_last_request_of_its_root() {
    let state = AppState::default();
    let (dir, g) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Log::default());
    let r1 = confirm(&state, 1, g, &[&["sub"]]);
    let r2 = confirm(&state, 2, g, &[&["top.bin"]]);
    done(start(&state, cache.path(), r1, logged(&log)));
    assert!(
        state.summary(g).is_ok(),
        "not compacted: R2 is planned on it"
    );
    assert_eq!(state.tree(g).unwrap().dead, 3);
    done(start(&state, cache.path(), r2, logged(&log)));
    let (sub, top) = (real(&dir, &["sub"]), real(&dir, &["top.bin"]));
    assert_eq!(*log.lock().unwrap(), [sub, top]);
    assert_eq!(state.summary(g), Err(CmdError::StaleId), "compacted");
    assert_eq!(state.summaries()[0].files, 0);
}

#[test]
fn a_refused_last_request_compacts_what_the_one_before_left() {
    let state = AppState::default();
    let (_dir, g) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Log::default());
    let r1 = confirm(&state, 1, g, &[&["sub"]]);
    let r2 = confirm(&state, 2, g, &[&["top.bin"]]);
    done(start(&state, cache.path(), r1, logged(&log)));
    assert_eq!(state.tree(g).unwrap().dead, 3, "R2 is still registered");
    refuse(&state, cache.path(), r2);
    assert_eq!(state.summary(g), Err(CmdError::StaleId), "compacted");
    assert_eq!(state.summaries()[0].files, 1);
}

#[test]
fn the_last_request_does_not_compact_while_the_app_closes() {
    let state = AppState::default();
    let (_dir, g) = open(&state);
    let (cache, (gate, go)) = (tempfile::tempdir().unwrap(), gate());
    let r = confirm(&state, 1, g, &[&["sub"]]);
    let running = start(&state, cache.path(), r, gate.trash_one());
    gate.next();
    assert_eq!(state.on_exit_request(), ExitDecision::PreventAndWait);
    drop(go);
    assert_eq!(done(running).removed, 1);
    assert!(state.summary(g).is_ok(), "not compacted");
    assert_eq!(state.tree(g).unwrap().dead, 3);
}

#[test]
fn a_tree_with_nothing_to_compact_waits_for_no_read() {
    let state = AppState::default();
    let (_dir, g) = open(&state);
    let root = root_of(&state, g);
    // A read of the tree that lasts: a change would wait for it.
    let reader = state.tree(g).unwrap();
    let ((tell, told), asked) = (mpsc::channel(), state.clone());
    thread::spawn(move || tell.send(asked.compact_if_idle(&root)).unwrap());
    assert_eq!(told.recv_timeout(HANG), Ok(false));
    drop(reader);
}
