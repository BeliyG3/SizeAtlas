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
