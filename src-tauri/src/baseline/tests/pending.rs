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

    let second = scan(&state, &dir, cache.path());
    assert!(!pending(&state, second), "a rescan ends compared");
    // Without a previous scan nothing is pending
    // (see `without_a_previous_scan_nothing_is_pending`).
    jobs::close_root(&state, &root);
    let opened = jobs::open_cached(&state, cache.path(), &root).unwrap();
    assert!(opened.baseline_pending);
    assert!(pending(&state, opened.generation));
    assert!(
        compare_later(&state, cache.path(), &root),
        "the UI hears of it"
    );
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

/// Scans `dir` as the worker does; returns whether its root's baseline was pending at each
/// `roots-changed`, which is when the UI reads it.
fn pending_seen(state: &AppState, dir: &TempDir, cache: &Path) -> Vec<bool> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (inspect, log) = (state.clone(), seen.clone());
    let notify: Notify = Arc::new(move |notice| {
        if matches!(notice, worker::Notice::RootsChanged) {
            let summaries = inspect.summaries();
            log.lock()
                .unwrap()
                .extend(summaries.iter().map(|s| s.baseline_pending));
        }
    });
    let job = state
        .enqueue(root_of(dir))
        .unwrap()
        .expect("nothing else runs");
    tauri::async_runtime::block_on(worker::run(state.clone(), cache.to_owned(), job, notify));
    seen.lock().unwrap().clone()
}

#[test]
fn without_a_previous_scan_nothing_is_pending() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let root = root_of(&dir);
    let seen = pending_seen(&state, &dir, cache.path());
    assert!(!seen.is_empty() && !seen.contains(&true), "{seen:?}");

    // A compaction has nothing to compare again either.
    let before = generation(&state);
    let (sub, _) = item(&state, before, &dir, "sub");
    let trashed = Trashed {
        id: sub,
        parent: 0,
        parent_before: None,
        parent_listed: None,
        parent_after: None,
    };
    state.remove_trashed(before, &[trashed], None).unwrap();
    assert_ne!(generation(&state), before, "the tree is compacted");
    assert!(!pending(&state, generation(&state)));

    // Nor a saved scan opened without `.base`.
    jobs::close_root(&state, &root);
    let opened = jobs::open_cached(&state, cache.path(), &root).unwrap();
    assert!(!opened.baseline_pending);
    assert!(!pending(&state, opened.generation));

    // A scan whose save makes the last full scan `.base` is pending until compared.
    jobs::close_root(&state, &root);
    let seen = pending_seen(&state, &dir, cache.path());
    assert!(seen.contains(&true), "{seen:?}");
    assert_eq!(seen.last(), Some(&false));
    assert!(state.baseline(generation(&state)).is_some());
}
