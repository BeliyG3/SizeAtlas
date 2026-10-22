use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use sizeatlas_core::baseline::NEW;
use sizeatlas_core::cache::{FORMAT_VERSION, scan_files};
use tempfile::TempDir;

use super::*;
use crate::jobs;
use crate::queue::ScanJob;
use crate::recycle::{self, fixture};
use crate::worker::{self, Notify};

/// root/top.bin and root/sub/{x.bin, y.bin}, with times the listings already show (a trash
/// checks them).
fn folder() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    fs::write(sub.join("x.bin"), vec![0u8; 1000]).unwrap();
    fs::write(sub.join("y.bin"), vec![0u8; 2000]).unwrap();
    fs::write(dir.path().join("top.bin"), vec![0u8; 3000]).unwrap();
    for item in [sub.join("x.bin"), sub.join("y.bin"), sub] {
        fixture::settle(&item);
    }
    fixture::settle(&dir.path().join("top.bin"));
    dir
}

fn root_of(dir: &TempDir) -> String {
    dunce::canonicalize(dir.path())
        .unwrap()
        .display()
        .to_string()
}

fn run_queue(state: &AppState, cache: &Path, job: Option<ScanJob>) {
    let notify: Notify = Arc::new(|_| {});
    let job = job.expect("nothing else runs");
    tauri::async_runtime::block_on(worker::run(state.clone(), cache.to_path_buf(), job, notify));
}

/// Scans `dir` (again, if it is open); returns the generation of its tree.
fn scan(state: &AppState, dir: &TempDir, cache: &Path) -> u64 {
    run_queue(state, cache, state.enqueue(root_of(dir)).unwrap());
    generation(state)
}

fn generation(state: &AppState) -> u64 {
    state.summaries()[0].generation
}

/// Id and on-disk size of the item at `path` below the root of the tree with `generation`.
fn item(state: &AppState, generation: u64, dir: &TempDir, path: &str) -> (u32, u64) {
    let tree = state.tree(generation).unwrap();
    let id = tree
        .find_path(&Path::new(&root_of(dir)).join(path))
        .expect("item exists");
    (id, tree.node(id).size)
}

fn files_of(dir: &TempDir, cache: &Path) -> ScanFiles {
    scan_files(cache, Path::new(&root_of(dir)))
}

fn bytes(path: &PathBuf) -> Vec<u8> {
    fs::read(path).unwrap()
}

/// Scans `dir` twice, so its root has a baseline; returns the generation of its tree.
fn scanned_twice(state: &AppState, dir: &TempDir, cache: &Path) -> u64 {
    scan(state, dir, cache);
    scan(state, dir, cache)
}

#[test]
fn rescan_sets_baseline() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let first = scan(&state, &dir, cache.path());
    assert!(state.baseline(first).is_none(), "no scan before the first");
    let (_, sub_before) = item(&state, first, &dir, "sub");
    fs::write(dir.path().join("sub").join("z.bin"), vec![0u8; 50_000]).unwrap();

    let second = scan(&state, &dir, cache.path());
    let (sub, sub_now) = item(&state, second, &dir, "sub");
    assert!(sub_now > sub_before);
    let baseline = state.baseline(second).expect("a rescan has a baseline");
    assert_eq!(baseline.before[sub as usize], sub_before);
    let (z, _) = item(&state, second, &dir, "sub/z.bin");
    assert_eq!(baseline.before[z as usize], NEW);

    // A first scan of a root that is not open, and a saved scan opened, get one too.
    jobs::close_root(&state, &root_of(&dir));
    let third = scan(&state, &dir, cache.path());
    assert!(
        state.baseline(third).is_some(),
        "a first scan has a baseline"
    );
    let opened = jobs::open_cached(&state, cache.path(), &root_of(&dir)).unwrap();
    assert!(
        state.baseline(opened.generation).is_some(),
        "an opened scan"
    );
}

#[test]
fn refresh_recomputes_the_baseline() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = scanned_twice(&state, &dir, cache.path());
    let (sub, _) = item(&state, generation, &dir, "sub");
    let (_, x_size) = item(&state, generation, &dir, "sub/x.bin");
    fs::write(dir.path().join("sub").join("new.bin"), vec![0u8; 50_000]).unwrap();

    let (root, folder) = state.refresh_target(generation, sub).unwrap();
    run_queue(
        &state,
        cache.path(),
        state.enqueue_folder(root, folder).unwrap(),
    );
    assert_eq!(generation, self::generation(&state), "no compaction");
    let baseline = state.baseline(generation).expect("kept");
    assert_eq!(baseline.before.len(), state.tree(generation).unwrap().len());
    let (x, _) = item(&state, generation, &dir, "sub/x.bin");
    let (new, _) = item(&state, generation, &dir, "sub/new.bin");
    assert_eq!(
        baseline.before[x as usize], x_size,
        "a new id of an old file"
    );
    assert_eq!(baseline.before[new as usize], NEW);
}

#[test]
fn compaction_recomputes_the_baseline() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = scanned_twice(&state, &dir, cache.path());
    let (sub, _) = item(&state, generation, &dir, "sub");
    let (_, top_size) = item(&state, generation, &dir, "top.bin");
    let log = Mutex::new(Vec::new());
    let rev = fixture::rev(&state, generation);

    // sub, x.bin and y.bin die, root and top.bin stay: the tree is compacted.
    recycle::run(
        &state,
        cache.path(),
        generation,
        rev,
        &[sub],
        fixture::anywhere,
        fixture::deleting(&log),
    )
    .unwrap();
    let compacted = self::generation(&state);
    assert_ne!(compacted, generation);
    let baseline = state.baseline(compacted).expect("recomputed");
    assert_eq!(baseline.before.len(), state.tree(compacted).unwrap().len());
    let (top, _) = item(&state, compacted, &dir, "top.bin");
    assert_eq!(baseline.before[top as usize], top_size);
}

#[test]
fn trash_keeps_baseline_and_files() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = scanned_twice(&state, &dir, cache.path());
    let files = files_of(&dir, cache.path());
    let (full, base) = (bytes(&files.full), bytes(&files.base));
    let (top, _) = item(&state, generation, &dir, "top.bin");
    let (sub, sub_size) = item(&state, generation, &dir, "sub");
    let log = Mutex::new(Vec::new());
    let rev = fixture::rev(&state, generation);

    recycle::run(
        &state,
        cache.path(),
        generation,
        rev,
        &[top],
        fixture::anywhere,
        fixture::deleting(&log),
    )
    .unwrap();
    assert_eq!(generation, self::generation(&state), "no compaction");
    let baseline = state.baseline(generation).expect("kept");
    assert_eq!(baseline.before[sub as usize], sub_size);
    assert_eq!(bytes(&files.full), full);
    assert_eq!(bytes(&files.base), base);
}

#[test]
fn cancelled_scan_keeps_files() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = scanned_twice(&state, &dir, cache.path());
    let files = files_of(&dir, cache.path());
    let saved = [&files.current, &files.full, &files.base].map(bytes);
    fs::write(dir.path().join("new.bin"), vec![0u8; 50_000]).unwrap();

    let job = state.enqueue(root_of(&dir)).unwrap();
    state.cancel_scan(None);
    run_queue(&state, cache.path(), job);
    assert_eq!(generation, self::generation(&state));
    assert!(state.baseline(generation).is_some());
    assert_eq!([&files.current, &files.full, &files.base].map(bytes), saved);
}

#[test]
fn outdated_base_gives_no_baseline() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = scanned_twice(&state, &dir, cache.path());
    let files = files_of(&dir, cache.path());
    let tree = state.tree(generation).unwrap();
    assert!(load_baseline(&files, &tree).is_some());

    // Magic, another format version, header length, a header that starts with the root.
    let root = root_of(&dir);
    let mut header = vec![root.len() as u8];
    header.extend_from_slice(root.as_bytes());
    let mut outdated = b"SZAT".to_vec();
    outdated.extend_from_slice(&(FORMAT_VERSION + 1).to_le_bytes());
    outdated.extend_from_slice(&(header.len() as u32).to_le_bytes());
    outdated.extend_from_slice(&header);
    fs::write(&files.base, outdated).unwrap();

    assert!(load_baseline(&files, &tree).is_none());
    let opened = jobs::open_cached(&state, cache.path(), &root).expect("no error");
    assert!(state.baseline(opened.generation).is_none());
}

#[test]
fn forget_removes_three_files() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    scanned_twice(&state, &dir, cache.path());
    let files = files_of(&dir, cache.path());
    assert!(
        [&files.current, &files.full, &files.base]
            .iter()
            .all(|f| f.exists())
    );

    jobs::forget(&state, cache.path(), &root_of(&dir)).unwrap();
    assert!(
        ![&files.current, &files.full, &files.base]
            .iter()
            .any(|f| f.exists())
    );
}

#[test]
fn a_failed_full_save_gives_no_baseline_even_after_a_refresh() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    scanned_twice(&state, &dir, cache.path());
    let files = files_of(&dir, cache.path());
    // `scanned_at` counts seconds: the unsaved scan must not share it with the saved one.
    thread::sleep(Duration::from_millis(1100));
    // A directory where the temporary file of `full` belongs makes the full save fail.
    let mut blocker = files.full.clone().into_os_string();
    blocker.push(".tmp");
    fs::create_dir(&blocker).unwrap();

    let generation = scan(&state, &dir, cache.path());
    assert!(state.baseline(generation).is_none(), "the full save failed");
    let (sub, _) = item(&state, generation, &dir, "sub");
    let (root, folder) = state.refresh_target(generation, sub).unwrap();
    run_queue(
        &state,
        cache.path(),
        state.enqueue_folder(root, folder).unwrap(),
    );
    assert!(
        state.baseline(generation).is_none(),
        "the base is two full scans back"
    );
}

#[test]
fn a_stale_baseline_is_not_installed_and_the_tree_keeps_its_revision() {
    let (dir, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = scan(&state, &dir, cache.path());
    let rev = state.tree(generation).unwrap().rev;
    let some = || {
        Some(Arc::new(Baseline {
            scanned_at: 0,
            before: Vec::new(),
            marks: Vec::new(),
            deleted: Vec::new(),
        }))
    };
    assert_eq!(state.set_baseline(generation + 1, rev, some()), None);
    assert_eq!(state.set_baseline(generation, rev + 1, some()), None);
    assert!(state.baseline(generation).is_none());
    assert_eq!(state.baseline_rev(generation), Some(0));

    assert_eq!(state.set_baseline(generation, rev, some()), Some(true));
    assert!(state.baseline(generation).is_some());
    assert_eq!(state.baseline_rev(generation), Some(1));
    assert_eq!(state.tree(generation).unwrap().rev, rev);
    assert_eq!(state.set_baseline(generation, rev, None), Some(true));
    assert_eq!(state.set_baseline(generation, rev, None), Some(false));
    assert_eq!(state.baseline_rev(generation), Some(2));
}

mod races;
