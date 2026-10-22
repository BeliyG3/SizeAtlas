//! A baseline computed while other work changes the same tree.

use std::sync::mpsc;

use super::*;
use crate::state::Trashed;

/// How long two threads that should both end may take; a deadlock takes forever.
const ENDS_WITHIN: Duration = Duration::from_secs(20);

#[test]
fn a_baseline_and_a_trash_of_the_same_tree_both_end() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = scan(&state, &dir, cache.path());
    let (top, _) = item(&state, generation, &dir, "top.bin");
    let (done, ended) = mpsc::channel();
    let (computing, computed) = mpsc::channel();

    // T1 computes a baseline: it holds the tree for a while, then gives the baseline.
    let (baseline_state, root, baseline_done) = (state.clone(), root_of(&dir), done.clone());
    thread::spawn(move || {
        give(&baseline_state, &root, |_| {
            let _ = computing.send(());
            thread::sleep(Duration::from_millis(300));
            None
        });
        baseline_done.send("baseline").unwrap();
    });
    computed.recv().unwrap();
    // T2 removes an item of the same tree meanwhile: it waits under the write lock for T1.
    thread::spawn(move || {
        let trashed = Trashed {
            id: top,
            parent: 0,
            parent_before: None,
            parent_listed: None,
            parent_after: None,
        };
        state.remove_trashed(generation, &[trashed], None).unwrap();
        done.send("trash").unwrap();
    });

    let mut both = [(); 2].map(|()| ended.recv_timeout(ENDS_WITHIN).expect("no deadlock"));
    both.sort_unstable();
    assert_eq!(both, ["baseline", "trash"]);
}

#[test]
fn an_opened_scan_is_compared_afterwards_once_busy_is_free() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    scanned_twice(&state, &dir, cache.path());
    let root = root_of(&dir);
    jobs::close_root(&state, &root);

    // A trash or a saved scan holds `busy`: opening does not wait for it, comparing does.
    let write = tauri::async_runtime::block_on(state.begin_write()).unwrap();
    let opened = jobs::open_cached(&state, cache.path(), &root).unwrap();
    assert!(
        state.baseline(opened.generation).is_none(),
        "not compared yet"
    );
    let (later_state, later_cache, later_root) = (state.clone(), cache.path().to_owned(), root);
    let later = thread::spawn(move || {
        tauri::async_runtime::block_on(refresh_later(later_state, later_cache, later_root))
    });
    thread::sleep(Duration::from_millis(200));
    assert!(
        state.baseline(opened.generation).is_none(),
        "waits for busy"
    );
    drop(write);

    assert!(later.join().unwrap(), "the baseline changed");
    assert!(state.baseline(opened.generation).is_some());
}
