//! Trash requests in the queues of their volumes: the order, the stops and the exit. The roots
//! are temporary folders named after their volume; items go through gated stand-ins of the
//! trash, never the real one.

use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;

use tauri::async_runtime::block_on;

use super::fixture::{
    HANG, Log, TrashOne, confirm, deleting, done, gate, hold_like_a_trash, id, logged, on_volumes,
    open, open_on, real, root_of, start,
};
use crate::error::CmdError;
use crate::exit::ExitDecision;
use crate::state::AppState;
use crate::writes::ready;
use crate::{sources, worker};

#[test]
fn two_requests_of_one_volume_run_one_after_the_other() {
    let state = on_volumes();
    let ((a, ga), (b, gb)) = (open_on(&state, "v1"), open_on(&state, "v1"));
    let (cache, (gate, go)) = (tempfile::tempdir().unwrap(), gate());
    let r1 = confirm(&state, 1, ga, &[&["top.bin"]]);
    let r2 = confirm(&state, 2, gb, &[&["top.bin"]]);
    let first = start(&state, cache.path(), r1, gate.trash_one());
    assert_eq!(gate.next(), real(&a, &["top.bin"]));
    let second = start(&state, cache.path(), r2, gate.trash_one());
    let waits = gate.entered.recv_timeout(Duration::from_millis(300));
    assert_eq!(waits, Err(RecvTimeoutError::Timeout), "the second waits");
    go.send(()).unwrap();
    assert_eq!(done(first).removed, 1);
    assert_eq!(gate.next(), real(&b, &["top.bin"]));
    go.send(()).unwrap();
    assert_eq!(done(second).removed, 1);
}

#[test]
fn requests_of_two_volumes_overlap() {
    let state = on_volumes();
    let ((_a, ga), (_b, gb)) = (open_on(&state, "v1"), open_on(&state, "v2"));
    let (cache, log) = (tempfile::tempdir().unwrap(), Log::default());
    // Each item goes only once the other request has an item in the trash too.
    let meets = |mine: Sender<()>, theirs: Receiver<()>| -> TrashOne {
        let log = log.clone();
        Box::new(move |path| {
            mine.send(()).unwrap();
            theirs.recv_timeout(HANG).map_err(|e| e.to_string())?;
            deleting(&log)(path)
        })
    };
    let ((a_in, a_seen), (b_in, b_seen)) = (mpsc::channel(), mpsc::channel());
    let r1 = confirm(&state, 1, ga, &[&["top.bin"]]);
    let r2 = confirm(&state, 2, gb, &[&["top.bin"]]);
    let first = start(&state, cache.path(), r1, meets(a_in, b_seen));
    let second = start(&state, cache.path(), r2, meets(b_in, a_seen));
    assert_eq!(done(first).removed, 1);
    assert_eq!(done(second).removed, 1);
}

#[test]
fn a_stop_of_one_volume_leaves_the_other_and_clears_its_queue() {
    let state = on_volumes();
    let ((a, ga), (_b, gb)) = (open_on(&state, "v1"), open_on(&state, "v2"));
    let (cache, (gate, go)) = (tempfile::tempdir().unwrap(), gate());
    let r1 = confirm(&state, 1, ga, &[&["top.bin"], &["sub", "x.bin"]]);
    let r2 = confirm(&state, 2, ga, &[&["sub", "y.bin"]]);
    let r3 = confirm(&state, 3, gb, &[&["top.bin"], &["sub", "x.bin"]]);
    let first = start(&state, cache.path(), r1, gate.trash_one());
    assert_eq!(gate.next(), real(&a, &["top.bin"]));
    let other = start(&state, cache.path(), r3, gate.trash_one());
    gate.next();
    let waiting = start(&state, cache.path(), r2, gate.trash_one());
    assert_eq!(state.stop_volume_of(1), 1, "the waiting one is cancelled");
    drop(go);
    let first = done(first);
    assert_eq!(
        (first.removed, first.stopped, first.cancelled),
        (1, true, false)
    );
    assert!(real(&a, &["sub", "x.bin"]).exists());
    assert!(done(waiting).cancelled);
    let y = real(&a, &["sub", "y.bin"]);
    assert!(!gate.log().contains(&y) && y.exists());
    let other = done(other);
    assert_eq!((other.removed, other.stopped), (2, false));
}

#[test]
fn a_stop_of_a_finished_request_stops_nothing() {
    let state = on_volumes();
    let ((_a, ga), (_b, gb)) = (open_on(&state, "v1"), open_on(&state, "v1"));
    let (cache, (gate, go)) = (tempfile::tempdir().unwrap(), gate());
    let r1 = confirm(&state, 1, ga, &[&["top.bin"]]);
    let r2 = confirm(&state, 2, gb, &[&["top.bin"]]);
    let first = start(&state, cache.path(), r1, gate.trash_one());
    gate.next();
    go.send(()).unwrap();
    assert_eq!(done(first).removed, 1);
    let second = start(&state, cache.path(), r2, gate.trash_one());
    gate.next();
    assert_eq!(state.stop_volume_of(1), 0, "a stale Stop");
    drop(go);
    let second = done(second);
    assert_eq!((second.removed, second.stopped), (1, false));
}

#[test]
fn a_stop_racing_the_start_counts_once() {
    let state = AppState::default();
    let _ticket = state.enqueue_trash(1, "/r", "v").unwrap();
    assert_eq!(state.stop_volume_of(1), 1);
    assert!(!state.start(1));
    assert_eq!(state.stop_volume_of(1), 0);
}

#[test]
fn a_duplicate_request_number_is_refused() {
    let state = AppState::default();
    let first = state.enqueue_trash(1, "/a", "v").unwrap();
    assert!(matches!(
        state.enqueue_trash(1, "/b", "v"),
        Err(CmdError::Busy)
    ));
    assert!(state.trash_pending("/a") && !state.trash_pending("/b"));
    assert_eq!(state.stop_volume_of(1), 1);
    assert!(first.stopped());
    drop(first);
    assert!(!state.trash_pending("/a"));
}

#[test]
fn queued_requests_run_in_the_order_they_were_confirmed() {
    let state = on_volumes();
    let (a, ga) = open_on(&state, "v1");
    let (cache, (gate, go)) = (tempfile::tempdir().unwrap(), gate());
    let r1 = confirm(&state, 1, ga, &[&["top.bin"]]);
    let first = start(&state, cache.path(), r1, gate.trash_one());
    gate.next();
    let r2 = confirm(&state, 2, ga, &[&["sub", "x.bin"]]);
    let r3 = confirm(&state, 3, ga, &[&["sub", "y.bin"]]);
    let third = start(&state, cache.path(), r3, gate.trash_one());
    let second = start(&state, cache.path(), r2, gate.trash_one());
    go.send(()).unwrap();
    assert_eq!(gate.next(), real(&a, &["sub", "x.bin"]));
    drop(go);
    for running in [first, second, third] {
        assert_eq!(done(running).removed, 1);
    }
}

#[test]
fn a_refresh_queued_while_a_request_waits_walks_after_it() {
    let state = on_volumes();
    let (a, ga) = open_on(&state, "v1");
    let (cache, (gate, go)) = (tempfile::tempdir().unwrap(), gate());
    let root = root_of(&state, ga);
    let r1 = confirm(&state, 1, ga, &[&["top.bin"]]);
    let r2 = confirm(&state, 2, ga, &[&["sub", "x.bin"]]);
    let first = start(&state, cache.path(), r1, gate.trash_one());
    gate.next();
    let second = start(&state, cache.path(), r2, gate.trash_one());
    let (of, folder) = state.refresh_target(ga, id(&state, ga, &["sub"])).unwrap();
    let job = state
        .enqueue_folder(of, folder)
        .unwrap()
        .expect("nothing runs");
    let (worker_state, dir) = (state.clone(), cache.path().to_owned());
    let refresh =
        thread::spawn(move || block_on(worker::run(worker_state, dir, job, Arc::new(|_| ()))));
    assert!(ready(state.volume_idle(&root)).is_none());
    go.send(()).unwrap();
    done(first);
    let x = real(&a, &["sub", "x.bin"]);
    assert_eq!(gate.next(), x);
    assert!(ready(state.volume_idle(&root)).is_none(), "the second runs");
    go.send(()).unwrap();
    assert_eq!(done(second).removed, 1);
    refresh.join().unwrap();
    let (_, tree) = state.root_tree(&root).unwrap();
    assert_eq!(tree.find_path(&x), None, "walked once x had gone");
}

#[test]
fn closing_stops_the_running_request_between_files_and_cancels_the_queue() {
    let state = on_volumes();
    let (a, ga) = open_on(&state, "v1");
    let (cache, (gate, go)) = (tempfile::tempdir().unwrap(), gate());
    let r1 = confirm(&state, 1, ga, &[&["top.bin"], &["sub", "x.bin"]]);
    let r2 = confirm(&state, 2, ga, &[&["sub", "y.bin"]]);
    let first = start(&state, cache.path(), r1, gate.trash_one());
    assert_eq!(gate.next(), real(&a, &["top.bin"]));
    let waiting = start(&state, cache.path(), r2, gate.trash_one());
    assert_eq!(state.on_exit_request(), ExitDecision::PreventAndWait);
    drop(go);
    assert_eq!(done(first).removed, 1);
    assert!(real(&a, &["sub", "x.bin"]).exists());
    assert_eq!(sources::cached_scans(cache.path())[0].files, 2, "saved");
    assert!(done(waiting).cancelled);
    assert!(real(&a, &["sub", "y.bin"]).exists());
    block_on(state.wait_until_idle());
    assert_eq!(state.on_exit_request(), ExitDecision::Allow);
}

#[test]
fn closing_with_only_queued_requests_exits_at_once() {
    let state = on_volumes();
    let (_a, ga) = open_on(&state, "v1");
    let (cache, (gate, go)) = (tempfile::tempdir().unwrap(), gate());
    // Another removal holds the turn of the volume, but not yet the root's write.
    let (turn, write) = hold_like_a_trash(&state, &root_of(&state, ga));
    drop(write);
    let r2 = confirm(&state, 2, ga, &[&["top.bin"]]);
    let waiting = start(&state, cache.path(), r2, gate.trash_one());
    drop(go);
    assert_eq!(state.on_exit_request(), ExitDecision::Allow);
    drop(turn);
    assert!(done(waiting).cancelled);
    assert!(gate.log().is_empty());
}

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
fn a_save_of_another_root_does_not_wait_for_a_trash_but_its_own_does() {
    let state = AppState::with_volumes(Arc::new(|_| "v".to_owned()));
    let ((_a, ga), (_b, gb)) = (open(&state), open(&state));
    let (a, b) = (root_of(&state, ga), root_of(&state, gb));
    let (cache, (gate, go)) = (tempfile::tempdir().unwrap(), gate());
    let r = confirm(&state, 1, ga, &[&["top.bin"]]);
    let running = start(&state, cache.path(), r, gate.trash_one());
    gate.next();
    assert!(ready(state.begin_write(&b)).is_some());
    assert!(ready(state.begin_write(&a)).is_none());
    go.send(()).unwrap();
    done(running);
    assert!(ready(state.begin_write(&a)).is_some());
}
