use std::fs;

use sizeatlas_core::tree::ListOrder;

use super::*;
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
            assert_totals(&tree);
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
            assert_totals(&tree);
            assert_eq!(tree.node(0).files as usize, finished.len() + 2);
            assert_eq!(
                tree.node(0).size,
                tree.children(0).map(|c| tree.node(c).size).sum::<u64>()
            );
            assert_eq!(tree.node(0).len as usize, 3 + 4 * (finished.len() + 1));
            assert_eq!(tree.node(0).dirs as usize, 2 + finished.len() + 1);
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
fn live_root_refuses_refresh_subfolder_scans_and_trash_of_unfinished_folders() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("f.txt"), b"file").unwrap();
    let state = AppState::default();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    let notify: Notify = Arc::new(|_| {});
    let mut session = Session::new();
    scanner::scan_live(dir.path(), &job.cancel, &job.progress, |event| {
        let finished = matches!(event, LiveEvent::FolderDone { .. });
        session.publish(&state, &job, event, &notify);
        let summary = state.summaries()[0].clone();
        assert_eq!(
            state.refresh_target(summary.generation, 0),
            Err(CmdError::Busy)
        );
        if finished {
            return;
        }
        let tree = state.tree(summary.generation).unwrap();
        let sub = tree.find_path(&Path::new(&job.root).join("sub")).unwrap();
        drop(tree);
        assert!(matches!(
            state.enqueue(format!("{}/sub", job.root)),
            Err(CmdError::Busy)
        ));
        assert_eq!(
            state.trash_preview(summary.generation, summary.rev, &[sub]),
            Err(CmdError::Busy)
        );
        assert!(matches!(
            crate::recycle::run(
                &state,
                cache.path(),
                summary.generation,
                summary.rev,
                &[sub],
                |_| panic!("no trash check"),
                |_| panic!("no trash")
            ),
            Err(CmdError::Busy)
        ));
    })
    .unwrap();
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
    assert_eq!(state.summary(old.generation).unwrap(), old);
    let inspected = state.clone();
    let notices = Arc::new(Mutex::new(0));
    let counter = notices.clone();
    let notify: Notify = Arc::new(move |notice| {
        assert!(
            !matches!(notice, Notice::LiveChanged),
            "an open root uses the non-live path"
        );
        let summaries = inspected.summaries();
        assert!(
            summaries.iter().all(|s| !s.scanning),
            "a rescan never installs a provisional root"
        );
        if matches!(notice, Notice::RootsChanged) {
            *counter.lock().unwrap() += 1;
        }
    });
    tauri::async_runtime::block_on(scan_one(&state, cache.path(), &job, &notify)).unwrap();
    assert_eq!(
        *notices.lock().unwrap(),
        2,
        "only completed installation is announced, then its baseline"
    );
    let summary = state.summaries()[0].clone();
    assert_eq!(summary.files, 2);
    assert_ne!(summary.generation, old.generation);
    let tree = state.tree(summary.generation).unwrap();
    assert_totals(&tree);
    assert_eq!((tree.node(0).len, tree.node(0).dirs), (6, 0));
}

// Validate all published ancestor totals, leaving pending folders' provisional counters alone.
pub(super) fn assert_totals(tree: &Tree) {
    tree.check_structure().unwrap();
    for id in 0..tree.len() as u32 {
        let n = tree.node(id);
        if !n.is_alive() || !n.is_dir() || n.has(sizeatlas_core::tree::flags::PENDING) {
            continue;
        }
        let totals = tree
            .children(id)
            .fold((0, 0, 0, 0), |(size, files, len, dirs), child| {
                let c = tree.node(child);
                (
                    size + c.size,
                    files + c.files,
                    len + c.len,
                    dirs + c.dirs + u32::from(c.is_dir()),
                )
            });
        assert_eq!(
            (n.size, n.files, n.len, n.dirs),
            totals,
            "totals of {}",
            tree.name(id)
        );
    }
    assert_eq!(
        tree.access_errors,
        (0..tree.len() as u32)
            .filter(|&id| {
                let n = tree.node(id);
                n.is_alive() && n.has(sizeatlas_core::tree::flags::ACCESS_ERROR)
            })
            .count() as u32
    );
}
