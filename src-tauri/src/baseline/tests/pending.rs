//! While a baseline is being computed, reads say so rather than "no previous scan".

use sizeatlas_core::tree::{ListKind, ListOrder};

use super::*;
use crate::state::Trashed;

/// Whether the summary, a folder's listing and the "grew most" list of the root with
/// `generation` say that its baseline is being computed; they agree.
fn pending(state: &AppState, generation: u64) -> bool {
    let summary = state.summary(generation).unwrap().baseline_pending;
    let children = state.children(generation, 0, 0, 10, ListOrder::DEFAULT);
    let list = state.list(generation, 0, ListKind::GrewMost, 10).unwrap();
    assert_eq!(children.unwrap().baseline_pending, summary);
    assert_eq!(list.baseline_pending, summary);
    summary
}

#[test]
fn an_opened_scan_is_pending_until_compared() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let first = scan(&state, &dir, cache.path());
    assert!(!pending(&state, first), "a scan ends compared");
    let root = root_of(&dir);

    // Without a previous scan, too: it says so once compared.
    let opened = jobs::open_cached(&state, cache.path(), &root).unwrap();
    assert!(opened.baseline_pending);
    assert!(pending(&state, opened.generation));
    assert!(
        compare_later(&state, cache.path(), &root),
        "the UI hears of it"
    );
    assert!(!pending(&state, opened.generation));
    assert!(state.baseline(opened.generation).is_none());

    let second = scan(&state, &dir, cache.path());
    assert!(!pending(&state, second), "a rescan ends compared");
    let opened = jobs::open_cached(&state, cache.path(), &root).unwrap();
    assert!(pending(&state, opened.generation));
    compare_later(&state, cache.path(), &root);
    assert!(!pending(&state, opened.generation));
    assert!(state.baseline(opened.generation).is_some());
}

#[test]
fn a_compacted_tree_is_pending_until_compared() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = scanned_twice(&state, &dir, cache.path());
    let (sub, _) = item(&state, generation, &dir, "sub");
    let trashed = Trashed {
        id: sub,
        parent: 0,
        parent_before: None,
        parent_listed: None,
        parent_after: None,
    };

    // sub, x.bin and y.bin die, root and top.bin stay: the tree is compacted.
    state.remove_trashed(generation, &[trashed], None).unwrap();
    let compacted = self::generation(&state);
    assert_ne!(compacted, generation);
    assert!(state.baseline(compacted).is_none());
    assert!(pending(&state, compacted));
    assert!(refresh(&state, cache.path(), &root_of(&dir)));
    assert!(!pending(&state, compacted));
    assert!(state.baseline(compacted).is_some());
}

#[test]
fn a_scan_whose_save_failed_is_not_pending() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    scan(&state, &dir, cache.path());
    let files = files_of(&dir, cache.path());
    thread::sleep(Duration::from_millis(1100));
    // As in `a_failed_full_save_gives_no_baseline_even_after_a_refresh`.
    let mut blocker = files.full.clone().into_os_string();
    blocker.push(".tmp");
    fs::create_dir(&blocker).unwrap();

    let generation = scan(&state, &dir, cache.path());
    assert!(state.baseline(generation).is_none());
    assert!(!pending(&state, generation));
    // A first scan, which ends through another path.
    jobs::close_root(&state, &root_of(&dir));
    let generation = scan(&state, &dir, cache.path());
    assert!(state.baseline(generation).is_none());
    assert!(!pending(&state, generation));
}
