use super::*;
use crate::exit::ExitDecision;
use crate::worker::tests::root_of;
use sizeatlas_core::tree::ListOrder;
use std::fs;

#[test]
fn closing_a_live_root_does_not_allow_a_batch_to_reopen_it() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub/f"), b"late").unwrap();
    let state = AppState::default();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    let notify: Notify = Arc::new(|_| {});
    let mut session = Session::new();
    let mut closed = false;
    scanner::scan_live(dir.path(), &job.cancel, &job.progress, |event| {
        let started = matches!(&event, LiveEvent::Started(_));
        session.publish(&state, &job, event, &notify);
        if started {
            let scan = session.scan.unwrap();
            let id = state
                .children(scan, 0, 0, 100, ListOrder::DEFAULT)
                .unwrap()
                .items[0]
                .id;
            let late = match scanner::scan(
                &dir.path().join("sub"),
                &AtomicBool::new(false),
                &scanner::Progress::default(),
            )
            .unwrap()
            {
                scanner::ScanOutcome::Done(tree) => tree,
                scanner::ScanOutcome::Cancelled => unreachable!(),
            };
            jobs::close_root(&state, &job.root);
            // Simulate a completed batch already in flight when Close acquired the queue lock.
            session.publish(
                &state,
                &job,
                LiveEvent::FolderDone { id, tree: late },
                &notify,
            );
            let write = tauri::async_runtime::block_on(state.begin_write()).unwrap();
            finish(&state, cache.path(), &job, scan, write, &notify).unwrap();
            closed = true;
        }
    })
    .unwrap();
    assert!(closed, "the late-batch path ran");
    assert!(state.summaries().is_empty());
    assert!(sources::cached_scans(cache.path()).is_empty());
}

#[test]
fn cancel_and_exit_remove_partial_roots_without_saving() {
    for exit in [false, true] {
        let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::create_dir(dir.path().join("sub")).unwrap();
        let state = AppState::default();
        let job = state.enqueue(root_of(&dir)).unwrap();
        let inspect = state.clone();
        let notify: Notify = Arc::new(move |notice| {
            if matches!(notice, Notice::RootsChanged)
                && inspect.summaries().iter().any(|s| s.scanning)
            {
                if exit {
                    assert_eq!(inspect.on_exit_request(), ExitDecision::Allow);
                } else {
                    inspect.cancel_scan(None);
                }
            }
        });
        tauri::async_runtime::block_on(run(
            state.clone(),
            cache.path().into(),
            job.unwrap(),
            notify,
        ));
        assert!(state.summaries().is_empty());
        assert!(sources::cached_scans(cache.path()).is_empty());
        assert!(state.roots().queue.is_empty());
    }
}

#[test]
fn exit_after_live_completion_waits_for_the_cache_write() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    let mut session = Session::new();
    let notify: Notify = Arc::new(|_| {});
    scanner::scan_live(dir.path(), &job.cancel, &job.progress, |event| {
        session.publish(&state, &job, event, &notify)
    })
    .unwrap();
    let write = tauri::async_runtime::block_on(state.begin_write()).unwrap();
    assert_eq!(state.on_exit_request(), ExitDecision::PreventAndWait);
    finish(
        &state,
        cache.path(),
        &job,
        session.scan.unwrap(),
        write,
        &notify,
    )
    .unwrap();
    assert_eq!(sources::cached_scans(cache.path()).len(), 1);
    assert!(!state.summaries()[0].scanning);
}
