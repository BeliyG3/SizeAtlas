use std::fs;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use sizeatlas_core::tree::ListOrder;
use tempfile::TempDir;

use super::tests::{root_of, run_queue};
use crate::error::CmdError;
use crate::sources;
use crate::state::AppState;

/// root/top0.bin … top4.bin, root/a/mid.bin and root/a/b/low.bin: 10 nodes, 7 files.
fn nested() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    let b = dir.path().join("a").join("b");
    fs::create_dir_all(&b).unwrap();
    for i in 0..5 {
        fs::write(dir.path().join(format!("top{i}.bin")), vec![0u8; 1000]).unwrap();
    }
    fs::write(dir.path().join("a").join("mid.bin"), vec![0u8; 2000]).unwrap();
    fs::write(b.join("low.bin"), vec![0u8; 3000]).unwrap();
    dir
}

/// Scans `dir` as a root (again, if it is open); returns the generation of its tree.
fn open(state: &AppState, dir: &TempDir, cache: &Path) -> u64 {
    run_queue(state, cache, state.enqueue(root_of(dir)).unwrap());
    state.summaries()[0].generation
}

/// Id of the child `name` of `id`.
fn child(state: &AppState, generation: u64, id: u32, name: &str) -> u32 {
    state
        .children(generation, id, 0, 100, ListOrder::DEFAULT)
        .unwrap()
        .items
        .into_iter()
        .find(|i| i.name == name)
        .expect("child exists")
        .id
}

/// Queues a refresh of `id` and runs the queue; returns its notices.
fn refresh(state: &AppState, cache: &Path, generation: u64, id: u32) -> Vec<String> {
    let (root, folder) = state.refresh_target(generation, id).unwrap();
    run_queue(state, cache, state.enqueue_folder(root, folder).unwrap())
}

#[test]
fn a_refreshed_folder_updates_its_ancestors_and_the_saved_scan() {
    let (dir, cache) = (nested(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = open(&state, &dir, cache.path());
    let before = state.summary(generation).unwrap();
    let a = child(&state, generation, 0, "a");
    let b = child(&state, generation, a, "b");
    fs::write(
        dir.path().join("a").join("b").join("new.bin"),
        vec![0u8; 50_000],
    )
    .unwrap();

    let log = refresh(&state, cache.path(), generation, b);
    assert!(log.iter().all(|l| l == "changed"), "{log:?}");
    let after = state.summary(generation).expect("ids stay valid");
    assert_eq!((after.rev, after.files), (before.rev + 1, before.files + 1));
    assert!(after.total > before.total);
    let items = state
        .children(generation, 0, 0, 10, ListOrder::DEFAULT)
        .unwrap()
        .items;
    assert_eq!(items.iter().find(|i| i.id == a).unwrap().files, 3);
    assert_eq!(
        sources::cached_scans(cache.path())[0].files,
        u64::from(after.files),
        "the change is saved"
    );
}

#[test]
fn a_folder_that_is_gone_is_removed() {
    let (dir, cache) = (nested(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = open(&state, &dir, cache.path());
    let a = child(&state, generation, 0, "a");
    let b = child(&state, generation, a, "b");
    fs::remove_dir_all(dir.path().join("a").join("b")).unwrap();

    refresh(&state, cache.path(), generation, b);
    let names: Vec<String> = state
        .children(generation, a, 0, 10, ListOrder::DEFAULT)
        .unwrap()
        .items
        .into_iter()
        .map(|i| i.name)
        .collect();
    assert_eq!(names, ["mid.bin"]);
    assert_eq!(state.live_ancestor(generation, b), Ok(a));
    assert_eq!(state.summary(generation).unwrap().files, 6);
}

#[test]
fn a_refresh_of_a_tree_changed_meanwhile_is_dropped() {
    let (dir, cache) = (nested(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = open(&state, &dir, cache.path());
    let a = child(&state, generation, 0, "a");
    let b = child(&state, generation, a, "b");
    fs::write(
        dir.path().join("a").join("b").join("new.bin"),
        vec![0u8; 50_000],
    )
    .unwrap();

    // The root is scanned again before the refresh runs: the result is for an old tree.
    let (root, old) = state.refresh_target(generation, b).unwrap();
    let rescanned = open(&state, &dir, cache.path());
    let current = state.summary(rescanned).unwrap();
    let log = run_queue(
        &state,
        cache.path(),
        state.enqueue_folder(root.clone(), old).unwrap(),
    );
    assert!(
        log.iter().all(|l| l == "changed"),
        "dropped, not failed: {log:?}"
    );
    assert_eq!(state.summary(rescanned).unwrap(), current);

    // The folder dies in the tree (its parent went to the trash) before its refresh runs.
    let a = child(&state, rescanned, 0, "a");
    let (_, inside) = state
        .refresh_target(rescanned, child(&state, rescanned, a, "b"))
        .unwrap();
    let scan = inside.as_ref().unwrap().scan;
    state
        .change_scan(scan, |tree, _| {
            tree.remove(a);
            Some(())
        })
        .unwrap();
    let removed = state
        .summary(rescanned)
        .expect("5 dead of 11: not compacted");
    let log = run_queue(
        &state,
        cache.path(),
        state.enqueue_folder(root, inside).unwrap(),
    );
    assert!(log.iter().all(|l| l == "changed"), "{log:?}");
    assert_eq!(
        state.summary(rescanned).unwrap(),
        removed,
        "a dead folder stays dead"
    );
}

#[test]
fn a_refresh_queued_before_a_compaction_still_finds_its_folder() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["big", "small"] {
        fs::create_dir(dir.path().join(name)).unwrap();
    }
    for i in 0..20 {
        fs::write(dir.path().join("big").join(format!("f{i}.bin")), b"x").unwrap();
    }
    fs::write(dir.path().join("small").join("one.bin"), b"x").unwrap();
    let cache = tempfile::tempdir().unwrap();
    let state = AppState::default();
    let generation = open(&state, &dir, cache.path());
    let big = child(&state, generation, 0, "big");
    let small = child(&state, generation, 0, "small");
    for i in 0..20 {
        fs::remove_file(dir.path().join("big").join(format!("f{i}.bin"))).unwrap();
    }
    fs::write(dir.path().join("small").join("two.bin"), b"x").unwrap();

    let (root, first) = state.refresh_target(generation, big).unwrap();
    let (_, second) = state.refresh_target(generation, small).unwrap();
    let job = state.enqueue_folder(root.clone(), first).unwrap();
    assert!(
        state.enqueue_folder(root, second).unwrap().is_none(),
        "waits for the first"
    );
    let log = run_queue(&state, cache.path(), job);
    assert!(log.iter().all(|l| l == "changed"), "{log:?}");
    let summary = &state.summaries()[0];
    assert!(
        summary.generation > generation,
        "20 dead of 4 live: the first one compacted"
    );
    assert_eq!(summary.files, 2, "the second found small again by its path");
}

#[test]
fn a_change_waits_for_reads_and_compacts_a_tree_that_is_mostly_dead() {
    let (dir, cache) = (nested(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = open(&state, &dir, cache.path());
    let a = child(&state, generation, 0, "a");

    // A read holds the tree for a while: the change waits for it instead of copying the tree.
    let held = state.tree(generation).unwrap();
    let reader = thread::spawn(move || {
        thread::sleep(Duration::from_millis(300));
        drop(held);
    });
    let start = Instant::now();
    refresh(&state, cache.path(), generation, a);
    assert!(
        start.elapsed() >= Duration::from_millis(200),
        "the change waited for the read"
    );
    reader.join().unwrap();

    // Each refresh of `a` leaves 3 dead nodes; 10 stay alive.
    for _ in 0..2 {
        refresh(&state, cache.path(), generation, a);
        assert_eq!(
            state.summaries()[0].generation,
            generation,
            "ids stay valid"
        );
    }
    refresh(&state, cache.path(), generation, a);
    let compacted = state.summaries()[0].generation;
    assert!(
        compacted > generation,
        "12 dead of 22: compacted, a new generation"
    );
    assert_eq!(state.summary(generation), Err(CmdError::StaleId));
    assert_eq!(state.summary(compacted).unwrap().files, 7);
}

#[test]
fn the_root_is_refreshed_by_a_full_scan_and_a_file_by_its_folder() {
    let (dir, cache) = (nested(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = open(&state, &dir, cache.path());
    let a = child(&state, generation, 0, "a");
    let mid = child(&state, generation, a, "mid.bin");
    assert_eq!(
        state.refresh_target(generation, 0).unwrap(),
        (root_of(&dir), None)
    );
    let (_, folder) = state.refresh_target(generation, mid).unwrap();
    let canonical = dunce::canonicalize(dir.path()).unwrap();
    assert_eq!(
        folder.map(|f| (f.id, f.path)),
        Some((a, canonical.join("a")))
    );
    assert_eq!(
        state.refresh_target(generation + 1, a),
        Err(CmdError::StaleId)
    );
    assert_eq!(
        state.live_ancestor(generation, 9_999),
        Err(CmdError::StaleId)
    );
}
