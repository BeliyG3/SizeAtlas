use std::fs;

use sizeatlas_core::tree::ListOrder;

use super::*;
use crate::exit::ExitDecision;
use crate::worker::tests::{root_of, run_queue};

#[test]
fn progress_grows_only_the_current_folder_and_root_without_exposing_contents() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub/f"), b"file").unwrap();
    let state = AppState::default();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    let notify: Notify = Arc::new(|_| {});
    let mut session = Session::new();
    scanner::scan_live(dir.path(), &job.cancel, &job.progress, |event| {
        let current = match &event {
            LiveEvent::FolderStarted { id, .. } => Some(*id),
            _ => None,
        };
        session.publish(&state, &job, event, &notify);
        if let Some(id) = current {
            job.progress.bytes.fetch_add(12345, Ordering::Relaxed);
            job.progress.files.fetch_add(3, Ordering::Relaxed);
            session.last = Instant::now() - LIVE_INTERVAL;
            session.tick(&state, &job, &notify);
            let tree = state.tree(session.scan.unwrap()).unwrap();
            assert_eq!(tree.node(id).size, 12345);
            assert_eq!(tree.node(0).size, 12345);
            assert_eq!((tree.node(id).files, tree.node(0).files), (3, 3));
            assert!(tree.node(id).has(sizeatlas_core::tree::flags::SCANNING));
            assert_eq!(tree.children(id).count(), 0);
            tree.check_structure().unwrap();
        }
    })
    .unwrap();
    let tree = state.tree(session.scan.unwrap()).unwrap();
    assert_eq!(
        tree.node(0).files,
        1,
        "final records replace provisional counters"
    );
    assert_eq!(
        tree.node(0).size,
        tree.children(0).map(|id| tree.node(id).size).sum::<u64>()
    );
}

#[test]
fn closing_a_live_root_does_not_allow_a_batch_to_reopen_it() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    fs::create_dir(dir.path().join("sub")).unwrap();
    let state = AppState::default();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    let inspect = state.clone();
    let root = job.root.clone();
    let notify: Notify = Arc::new(move |notice| {
        if matches!(notice, Notice::RootsChanged) && inspect.summaries().iter().any(|s| s.scanning)
        {
            jobs::close_root(&inspect, &root);
        }
    });
    tauri::async_runtime::block_on(run(state.clone(), cache.path().into(), job, notify));
    assert!(state.summaries().is_empty());
    assert!(sources::cached_scans(cache.path()).is_empty());
}

#[test]
fn live_batches_are_browsable_stable_and_not_saved_until_finished() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    fs::write(dir.path().join("top.txt"), b"top").unwrap();
    for name in ["b", "a"] {
        fs::create_dir_all(dir.path().join(name).join("deep")).unwrap();
        fs::write(dir.path().join(name).join("deep/f.txt"), b"file").unwrap();
    }
    let state = AppState::default();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    let mut session = Session::new();
    let notify: Notify = Arc::new(|_| {});
    let mut generation = 0;
    let mut finished = Vec::new();
    scanner::scan_live(dir.path(), &job.cancel, &job.progress, |event| {
        let done = match &event {
            LiveEvent::FolderDone { id, .. } => Some(*id),
            _ => None,
        };
        session.publish(&state, &job, event, &notify);
        let summary = state.summaries()[0].clone();
        if generation == 0 {
            generation = summary.generation;
        }
        assert_eq!(summary.generation, generation);
        assert!(summary.scanning);
        assert!(sources::cached_scans(cache.path()).is_empty());
        if let Some(id) = done {
            let tree = state.tree(generation).unwrap();
            tree.check_structure().unwrap();
            assert_eq!(tree.node(0).files as usize, finished.len() + 2);
            assert_eq!(
                tree.node(0).size,
                tree.children(0).map(|c| tree.node(c).size).sum::<u64>()
            );
            finished.push((id, tree.name(id).to_owned()));
            for (id, name) in &finished {
                assert_eq!(tree.name(*id), name);
            }
            drop(tree);
            assert_eq!(
                state
                    .children(generation, id, 0, 100, ListOrder::DEFAULT)
                    .unwrap()
                    .items
                    .len(),
                1
            );
        }
    })
    .unwrap();
    let write = tauri::async_runtime::block_on(state.begin_write()).unwrap();
    finish(&state, cache.path(), &job, generation, write, &notify).unwrap();
    assert!(!state.summary(generation).unwrap().scanning);
    assert_eq!(sources::cached_scans(cache.path()).len(), 1);
    assert_eq!(
        finished.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>(),
        ["a", "b"]
    );
}

#[test]
fn live_root_refuses_refresh_subfolder_scans_and_trash() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("f.txt"), b"file").unwrap();
    let state = AppState::default();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    let notify: Notify = Arc::new(|_| {});
    let mut session = Session::new();
    scanner::scan_live(dir.path(), &job.cancel, &job.progress, |event| {
        session.publish(&state, &job, event, &notify);
        let summary = state.summaries()[0].clone();
        assert_eq!(
            state.refresh_target(summary.generation, 0),
            Err(CmdError::Busy)
        );
        assert!(matches!(
            state.enqueue(format!("{}/sub", job.root)),
            Err(CmdError::Busy)
        ));
        assert_eq!(
            state.trash_preview(summary.generation, summary.rev, &[1]),
            Err(CmdError::Busy)
        );
        assert!(matches!(
            crate::recycle::run(
                &state,
                cache.path(),
                summary.generation,
                summary.rev,
                &[1],
                |_, _| panic!("no trash check"),
                |_| panic!("no trash")
            ),
            Err(CmdError::Busy)
        ));
    })
    .unwrap();
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
fn rescan_keeps_the_complete_tree_until_installation() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    fs::write(dir.path().join("f"), b"old").unwrap();
    let state = AppState::default();
    run_queue(&state, cache.path(), state.enqueue(root_of(&dir)).unwrap());
    let old = state.summaries()[0].clone();
    fs::write(dir.path().join("new"), b"new").unwrap();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    let walked = jobs::walk(&job).unwrap().unwrap();
    assert_eq!(state.summary(old.generation).unwrap(), old);
    let write = tauri::async_runtime::block_on(state.begin_write()).unwrap();
    let notify: Notify = Arc::new(|_| {});
    install_and_save(&state, cache.path(), &job, walked, write, &notify).unwrap();
    assert_eq!(state.summaries()[0].files, 2);
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
