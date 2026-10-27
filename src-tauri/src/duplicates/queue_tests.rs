//! A trash of duplicates in the removal queues: the turns of the volumes of its copies and of
//! the copy that stays, the order with other requests, the stops. The roots are temporary
//! folders named after their volume (`a-…`, `b-…`, `c-…`).

use std::sync::Mutex;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use super::trash_fixture::{Dups, at, ended, two_big, with_keep};
use crate::error::CmdError;
use crate::recycle::fixture::{
    self as plain, HANG, TrashOne, done, gate, hold_like_a_trash, logged,
};
use crate::writes::ready;

/// How long a test lets a request that must wait show that it does not.
const WAITS: Duration = Duration::from_millis(200);

fn generation(t: &Dups, root: &str) -> u64 {
    t.state.root_tree(root).unwrap().0
}

#[test]
fn copies_on_two_volumes_go_in_one_request() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("k", 1), ("x", 1)]);
    let (_db, b) = t.root("b", &[("y", 1)]);
    t.find(false);
    let confirmed = t.confirm(1, &[at(&a, "x"), at(&b, "y")]).unwrap();
    let (gate, go) = gate();
    let running = t.start(confirmed, gate.trash_one());
    assert_eq!(gate.next(), at(&a, "x"));
    assert!(t.state.trash_pending(&a) && t.state.trash_pending(&b));
    drop(go);
    assert_eq!(ended(running).unwrap().removed, 2);
    assert_eq!(gate.log(), [at(&a, "x"), at(&b, "y")]);
}

/// Starts the request for `a/x` and checks it waits: no progress, nothing moved.
fn waits(t: &Dups, a: &str) -> std::thread::JoinHandle<Result<crate::dto::TrashDto, CmdError>> {
    let confirmed = t.confirm(1, &[at(a, "x")]).unwrap();
    let (sent, events) = mpsc::channel();
    let running = t.start_reporting(confirmed, logged(&t.log), move |p| {
        let _ = sent.send(p);
    });
    assert_eq!(
        events.recv_timeout(WAITS).err(),
        Some(RecvTimeoutError::Timeout)
    );
    assert!(t.logged().is_empty());
    running
}

#[test]
fn a_removal_on_the_kept_copys_volume_holds_the_batch() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x", 1)]);
    let (_dc, c) = t.root("c", &[("k", 1)]);
    t.find(false);
    let held = hold_like_a_trash(&t.state, &c);
    let running = waits(&t, &a);
    drop(held);
    assert_eq!(ended(running).unwrap().removed, 1);
}

#[test]
fn a_removal_in_an_outer_root_of_the_kept_copy_holds_the_batch() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x", 1)]);
    let outer = super::tests::dir_named("o-");
    super::trash_fixture::write(outer.path(), &[("c-in/k", 1)]);
    t.open(&outer.path().join("c-in"));
    let o = t.open(outer.path());
    t.find(false);
    let held = hold_like_a_trash(&t.state, &o);
    let running = waits(&t, &a);
    drop(held);
    assert_eq!(ended(running).unwrap().removed, 1);
}

#[test]
fn a_removal_in_a_root_scanned_at_find_time_holds_the_batch() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x", 1)]);
    let outer = super::tests::dir_named("o-");
    super::trash_fixture::write(outer.path(), &[("c-in/k", 1)]);
    t.open(&outer.path().join("c-in"));
    let o = t.open(outer.path());
    // Being scanned: the search leaves it out, so its queue is not in the result.
    t.state.enqueue(o.clone()).unwrap();
    t.find(false);
    assert_eq!(t.dto().skipped, std::slice::from_ref(&o));
    let held = hold_like_a_trash(&t.state, &o);
    let running = waits(&t, &a);
    drop(held);
    assert_eq!(ended(running).unwrap().removed, 1);
}

#[test]
fn a_removal_of_the_kept_copy_queued_before_refuses() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x", 1)]);
    let (_dc, c) = t.root("c", &[("k", 1)]);
    t.find(false);
    let (gate, go) = gate();
    let k = plain::confirm(&t.state, 1, generation(&t, &c), &[&["k"]]);
    let first = plain::start(&t.state, t.cache.path(), k, gate.trash_one());
    assert_eq!(gate.next(), at(&c, "k"));
    let batch = t.confirm(2, &[at(&a, "x")]).unwrap();
    let running = t.start(batch, logged(&t.log));
    drop(go);
    assert_eq!(done(first).removed, 1);
    assert_eq!(ended(running).err(), Some(CmdError::StaleId));
    assert!(at(&a, "x").exists());
    assert!(t.logged().is_empty());
}

#[test]
fn two_requests_on_one_group_keep_one_copy() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("a", 1), ("b", 1)]);
    t.find(false);
    let (gate, go) = gate();
    let first = t.confirm(1, &[at(&a, "b")]).unwrap();
    let first = t.start(first, gate.trash_one());
    assert_eq!(gate.next(), at(&a, "b"));
    // Confirmed while the first one runs: it would keep `b`, which is going.
    let second = t.confirm(2, &[at(&a, "a")]).unwrap();
    let second = t.start(second, logged(&t.log));
    drop(go);
    assert_eq!(ended(first).unwrap().removed, 1);
    assert_eq!(ended(second).err(), Some(CmdError::StaleId));
    assert!(at(&a, "a").exists());
}

#[test]
fn batches_in_reverse_volume_order_end() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x1", 1), ("k2", 2)]);
    let (_db, b) = t.root("b", &[("k1", 1), ("x2", 2), ("other", 3)]);
    t.find(false);
    let (gate, go) = gate();
    let first = t.confirm(1, &[at(&a, "x1")]).unwrap();
    let first = t.start(first, gate.trash_one());
    assert_eq!(gate.next(), at(&a, "x1"));
    let other = plain::confirm(&t.state, 2, generation(&t, &b), &[&["other"]]);
    let other = plain::start(&t.state, t.cache.path(), other, logged(&t.log));
    let second = t.confirm(3, &[at(&b, "x2")]).unwrap();
    let second = t.start(second, logged(&t.log));
    drop(go);
    assert_eq!(ended(first).unwrap().removed, 1);
    assert_eq!(ended(other).unwrap().removed, 1);
    assert_eq!(
        ended(second).err(),
        Some(CmdError::StaleId),
        "b moved since"
    );
    assert!(at(&b, "x2").exists());
}

#[test]
fn a_stop_cancels_the_queues_of_the_batch_volumes() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x", 1)]);
    let (_db, b) = t.root("b", &[("y", 1), ("other", 3)]);
    let (_dc, c) = t.root("c", &[("k", 1), ("other", 4)]);
    t.find(false);
    let (gate, go) = gate();
    let batch = t.confirm(1, &[at(&a, "x"), at(&b, "y")]).unwrap();
    let batch = t.start(batch, gate.trash_one());
    assert_eq!(gate.next(), at(&a, "x"));
    let on_b = plain::confirm(&t.state, 2, generation(&t, &b), &[&["other"]]);
    let on_b = plain::start(&t.state, t.cache.path(), on_b, logged(&t.log));
    let on_c = plain::confirm(&t.state, 3, generation(&t, &c), &[&["other"]]);
    let on_c = plain::start(&t.state, t.cache.path(), on_c, logged(&t.log));
    assert_eq!(t.state.stop_volume_of(1), 1, "the one waiting on b");
    drop(go);
    let batch = ended(batch).unwrap();
    assert_eq!((batch.removed, batch.stopped), (1, true));
    assert!(at(&b, "y").exists());
    assert!(done(on_b).cancelled);
    assert_eq!(
        done(on_c).removed,
        1,
        "the volume of the kept copy is not stopped"
    );
}

#[test]
fn a_stop_of_another_request_stops_the_whole_batch() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x1", 1), ("x2", 1), ("k", 1)]);
    let (_db, b) = t.root("b", &[("y", 1), ("other", 3)]);
    t.find(false);
    let (gate, go) = gate();
    let batch = t.confirm(1, &[at(&a, "x1"), at(&a, "x2"), at(&b, "y")]);
    let batch = t.start(batch.unwrap(), gate.trash_one());
    assert_eq!(gate.next(), at(&a, "x1"));
    let on_b = plain::confirm(&t.state, 2, generation(&t, &b), &[&["other"]]);
    let on_b = plain::start(&t.state, t.cache.path(), on_b, logged(&t.log));
    assert_eq!(t.state.stop_volume_of(2), 1);
    drop(go);
    let batch = ended(batch).unwrap();
    assert_eq!((batch.removed, batch.stopped), (1, true));
    assert!(at(&a, "x2").exists() && at(&b, "y").exists());
    assert!(done(on_b).cancelled);
}

#[test]
fn a_stop_after_the_first_copy_keeps_the_rest() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x1", 1), ("x2", 1), ("k", 1)]);
    t.find(false);
    let ((moved, first), (go, wait)) = (mpsc::channel(), mpsc::channel::<()>());
    let (log, wait) = (t.log.clone(), Mutex::new(wait));
    let signalling: TrashOne = Box::new(move |path| {
        logged(&log)(path)?;
        moved.send(()).unwrap();
        wait.lock()
            .unwrap()
            .recv_timeout(HANG)
            .map_err(|e| e.to_string())
    });
    let batch = t.confirm(1, &[at(&a, "x1"), at(&a, "x2")]).unwrap();
    let running = t.start(batch, signalling);
    first.recv_timeout(HANG).expect("the first copy moved");
    t.state.stop_volume_of(1);
    go.send(()).unwrap();
    let done = ended(running).unwrap();
    assert_eq!((done.removed, done.stopped), (1, true));
    assert!(at(&a, "x2").exists());
    let x2 = at(&a, "x2").display().to_string();
    assert!(t.groups()[0].contains(&x2));
}

#[test]
fn a_stop_during_the_rehash_moves_nothing() {
    let t = Dups::new();
    let (_dirs, a, keep) = two_big(&t);
    let state = t.state.clone();
    let done = with_keep(&t, &a, &keep, move || {
        state.stop_volume_of(1);
    })
    .unwrap();
    assert!(done.stopped && !done.cancelled);
    assert_eq!(done.removed, 0);
    assert!(t.logged().is_empty());
    assert!(!t.dto().groups[0].stale);
}

#[test]
fn a_stopped_batch_releases_the_granted_turns() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x", 1), ("k", 1), ("other", 3)]);
    let (_db, b) = t.root("b", &[("y", 1)]);
    t.find(false);
    let held = hold_like_a_trash(&t.state, &b);
    let batch = t.confirm(1, &[at(&a, "x"), at(&b, "y")]).unwrap();
    let running = t.start(batch, logged(&t.log));
    assert!(ready(t.state.volume_turn("a")).is_none(), "the batch has a");
    assert_eq!(t.state.stop_volume_of(1), 1);
    drop(held);
    assert!(ended(running).unwrap().cancelled);
    assert!(t.logged().is_empty());
    let other = plain::confirm(&t.state, 2, generation(&t, &a), &[&["other"]]);
    let other = plain::start(&t.state, t.cache.path(), other, logged(&t.log));
    assert_eq!(done(other).removed, 1);
}

#[test]
fn find_during_a_queued_trash_is_busy() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x", 1), ("k", 1)]);
    t.find(false);
    let held = hold_like_a_trash(&t.state, &a);
    let batch = t.confirm(1, &[at(&a, "x")]).unwrap();
    let running = t.start(batch, logged(&t.log));
    let (emit, _) = super::tests::recorder();
    let found = t.state.find_duplicates(String::new(), false, None, emit);
    assert_eq!(found.err(), Some(CmdError::Busy));
    drop(held);
    assert_eq!(ended(running).unwrap().removed, 1);
}

#[test]
fn the_batch_defers_compaction_of_each_root() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("x1", 1), ("x2", 1)]);
    let (_db, b) = t.root("b", &[("y1", 1), ("y2", 1)]);
    let (_dc, _c) = t.root("c", &[("k", 1)]);
    t.find(false);
    let (ga, gb) = (generation(&t, &a), generation(&t, &b));
    let paths = [at(&a, "x1"), at(&a, "x2"), at(&b, "y1"), at(&b, "y2")];
    let (gate, go) = gate();
    let running = t.start(t.confirm(1, &paths).unwrap(), gate.trash_one());
    for path in &paths[..3] {
        assert_eq!(gate.next(), *path);
        go.send(()).unwrap();
    }
    assert_eq!(gate.next(), paths[3]);
    assert_eq!(
        (generation(&t, &a), generation(&t, &b)),
        (ga, gb),
        "deferred"
    );
    drop(go);
    assert_eq!(ended(running).unwrap().removed, 4);
    assert_ne!(generation(&t, &a), ga, "compacted at the end");
    assert_ne!(generation(&t, &b), gb);
    assert!(t.dto().stale);
    assert!(t.state.duplicates_status().stale, "the status says so");
}

#[test]
fn repeated_roots_and_volumes_are_joined_once() {
    let t = Dups::new();
    let (_d1, a1) = t.root("a", &[("x", 1), ("k", 1)]);
    let (_d2, a2) = t.root("a", &[("y", 1)]);
    t.find(false);
    let refs = [at(&a1, "x"), at(&a2, "y"), at(&a1, "x")];
    let running = t.start(t.confirm(1, &refs).unwrap(), logged(&t.log));
    assert_eq!(ended(running).unwrap().removed, 2);
}
