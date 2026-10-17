use std::fs;
use std::sync::atomic::AtomicUsize;

use super::tests::assert_totals;
use super::*;
use crate::worker::tests::{root_of, run_queue};

#[test]
fn cache_open_is_busy_before_and_after_live_root_publication() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    fs::create_dir(dir.path().join("sub")).unwrap();
    let state = AppState::default();
    run_queue(&state, cache.path(), state.enqueue(root_of(&dir)).unwrap());
    jobs::close_root(&state, &root_of(&dir));
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    assert_eq!(
        jobs::open_cached(&state, cache.path(), &job.root),
        Err(CmdError::Busy)
    );
    let notify: Notify = Arc::new(|_| {});
    let mut session = Session::new();
    scanner::scan_live(dir.path(), &job.cancel, &job.progress, |event| {
        session.publish(&state, &job, event, &notify);
        assert_eq!(
            jobs::open_cached(&state, cache.path(), &job.root),
            Err(CmdError::Busy)
        );
        assert_totals(&state.tree(session.scan.unwrap()).unwrap());
    })
    .unwrap();
    let scan = session.scan.unwrap();
    let write = tauri::async_runtime::block_on(state.begin_write()).unwrap();
    finish(&state, cache.path(), &job, scan, write, &notify).unwrap();
    assert_eq!(
        jobs::open_cached(&state, cache.path(), &job.root),
        Err(CmdError::Busy)
    );
    state.next_scan();
    assert!(jobs::open_cached(&state, cache.path(), &job.root).is_ok());
}

#[test]
fn a_root_opened_after_the_first_scan_decision_is_replaced_and_result_saved() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    fs::write(dir.path().join("old"), b"old").unwrap();
    let state = AppState::default();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    assert!(!state.has_root(&job.root));
    // Simulate a cache install that completed after the worker's has_root decision.
    let stale = state.install_tree(jobs::walk(&job).unwrap().unwrap());
    fs::write(dir.path().join("new"), b"new").unwrap();
    let notify: Notify = Arc::new(|_| {});
    tauri::async_runtime::block_on(scan_first(&state, cache.path(), &job, &notify)).unwrap();
    let summary = state.summaries()[0].clone();
    assert_ne!(summary.generation, stale);
    assert_eq!(summary.files, 2);
    assert!(!summary.scanning);
    assert_totals(&state.tree(summary.generation).unwrap());
    state.next_scan();
    let loaded = jobs::open_cached(&state, cache.path(), &job.root).unwrap();
    assert_eq!(loaded.files, 2);
}

#[test]
fn unchanged_counters_and_absent_sessions_emit_no_live_ticks() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    let state = AppState::default();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let ticks = count.clone();
    let notify: Notify = Arc::new(move |n| {
        if matches!(n, Notice::LiveChanged) {
            ticks.fetch_add(1, Ordering::Relaxed);
        }
    });
    let mut session = Session::new();
    session.last = Instant::now() - LIVE_INTERVAL;
    session.tick(&state, &job, &notify);
    assert_eq!(count.load(Ordering::Relaxed), 0);
    scanner::scan_live(dir.path(), &job.cancel, &job.progress, |event| {
        let starting = matches!(&event, LiveEvent::FolderStarted { .. });
        session.publish(&state, &job, event, &notify);
        if starting {
            session.last = Instant::now() - LIVE_INTERVAL;
            session.tick(&state, &job, &notify); // The scanning flag is a real edit.
            let rev = state.summary(session.scan.unwrap()).unwrap().rev;
            let count_before = count.load(Ordering::Relaxed);
            session.last = Instant::now() - session.interval;
            session.tick(&state, &job, &notify);
            assert_eq!(state.summary(session.scan.unwrap()).unwrap().rev, rev);
            assert_eq!(count.load(Ordering::Relaxed), count_before);
        }
    })
    .unwrap();
}

#[test]
fn queued_rescan_allows_old_tree_actions_and_running_rescan_allows_only_trash() {
    let (dir, cache, other) = (
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
    );
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("f"), b"file").unwrap();
    let state = AppState::default();
    run_queue(&state, cache.path(), state.enqueue(root_of(&dir)).unwrap());
    let summary = state.summaries()[0].clone();
    state.enqueue(root_of(&other)).unwrap().unwrap();
    assert!(state.enqueue(root_of(&dir)).unwrap().is_none());
    assert!(state.refresh_target(summary.generation, 0).is_ok());
    assert!(
        state
            .trash_preview(summary.generation, summary.rev, &[1])
            .is_ok()
    );
    assert!(
        state
            .enqueue(dir.path().join("sub").display().to_string())
            .is_ok()
    );
    // Stand-in trash: it must reach the safety callback while the rescan waits.
    let result = crate::recycle::run(
        &state,
        cache.path(),
        summary.generation,
        summary.rev,
        &[1],
        |_, _| false,
        |_| panic!("no real trash"),
    );
    assert!(result.is_ok());
    let running = state.next_scan().unwrap();
    assert_eq!(running.root, root_of(&dir));
    assert_eq!(
        state.refresh_target(summary.generation, 0),
        Err(CmdError::Busy)
    );
    assert!(
        state
            .trash_preview(summary.generation, summary.rev, &[1])
            .is_ok(),
        "the old tree is complete: the rescan is told what goes"
    );
}
