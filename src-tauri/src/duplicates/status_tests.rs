//! The statuses of a search job: each carries its id, the end comes last with the newest
//! version, also after a panic.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::Emit;
use super::tests::{find, open_pair, recorder, state};

#[test]
fn a_panic_in_the_search_still_ends_the_job() {
    let (state, _) = state();
    let _dir = open_pair(&state, "panic");
    let (record, log) = recorder();
    let panicked = AtomicBool::new(false);
    let emit: Emit = Arc::new(move |s| {
        if !panicked.swap(true, Ordering::SeqCst) {
            panic!("the first status fails");
        }
        record(s);
    });
    let (job, handle) = state
        .find_duplicates(String::new(), false, None, emit)
        .unwrap();
    assert!(handle.join().is_err());
    assert!(!state.duplicates_running());
    let dto = state.duplicates_since(0, 0);
    assert!(!dto.running && !dto.status.running && !dto.complete);
    let log = log.lock().unwrap();
    assert_eq!(log.len(), 1);
    assert_eq!((log[0].job, log[0].running), (job, false));
}

/// A late answer read while the job ran must never look newer than its end: the UI would show
/// Cancel again.
#[test]
fn the_end_of_a_job_has_a_version_after_every_running_status() {
    let (state, _) = state();
    let _dir = open_pair(&state, "ended");
    let (record, log) = recorder();
    let first = Arc::new(Mutex::new(None));
    let seen = first.clone();
    let emit: Emit = Arc::new(move |s| {
        // The first status ends the search by a panic, before anything bumps the version.
        let mut seen = seen.lock().unwrap();
        if seen.is_none() {
            *seen = Some(s.version);
            drop(seen);
            panic!("the first status fails");
        }
        record(s);
    });
    let (_, handle) = state
        .find_duplicates(String::new(), false, None, emit)
        .unwrap();
    assert!(handle.join().is_err());
    let running = first.lock().unwrap().expect("a running status");
    let log = log.lock().unwrap();
    assert!(!log[0].running);
    assert!(
        log[0].version > running,
        "{} after {running}",
        log[0].version
    );
}

#[test]
fn every_status_of_a_job_carries_its_id() {
    let (state, _) = state();
    let _dir = open_pair(&state, "status");
    let (emit, statuses) = recorder();
    let job = find(&state, emit);
    let statuses = statuses.lock().unwrap();
    let (last, before) = statuses.split_last().expect("statuses");
    assert!(statuses.iter().all(|s| s.job == job));
    assert!(before.iter().all(|s| s.running && s.version < last.version));
    assert!(!last.running);
    assert_eq!(last.version, state.duplicates_since(0, 0).version);
    assert!(!state.duplicates_running());
}
