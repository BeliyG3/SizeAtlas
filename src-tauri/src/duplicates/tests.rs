//! The search service on real files in a temporary folder: jobs, their statuses, the kept
//! result, staleness, and that nothing waits for a search.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use sizeatlas_core::cleanup::{Context, Known, Os};
use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};
use sizeatlas_core::tree::Tree;
use tempfile::TempDir;

use super::Emit;
use crate::cleanup::ContextFn;
use crate::dto::{DuplicatesDto, StatusDto};
use crate::error::CmdError;
use crate::recycle::fixture::{HANG, settle};
use crate::state::AppState;

const LEN: usize = 8192;

/// A temporary folder named `prefix…` outside `%TEMP%`, which lies in a protected zone on
/// Windows.
pub(super) fn dir_named(prefix: &str) -> TempDir {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/test-tmp");
    fs::create_dir_all(&base).unwrap();
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(base)
        .unwrap()
}

pub(super) fn scanned(path: &Path) -> Tree {
    match scan(path, &AtomicBool::new(false), &Progress::default()).unwrap() {
        ScanOutcome::Done(tree) => tree,
        ScanOutcome::Cancelled => panic!("not cancelled"),
    }
}

/// A context that knows nothing and counts how often it is asked.
pub(super) fn counting() -> (ContextFn, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = calls.clone();
    let context: ContextFn = Arc::new(move |_: &Path| {
        counted.fetch_add(1, Ordering::SeqCst);
        Context {
            os: Os::current(),
            known: Known::default(),
            running: Vec::new(),
            reboot_pending: false,
            recyclable: false,
        }
    });
    (context, calls)
}

fn state() -> (AppState, Arc<AtomicUsize>) {
    let (context, calls) = counting();
    (AppState::with_context(context), calls)
}

/// `a` and `b` of equal bytes, `c` of another length, scanned and open; the folder, its root
/// and its generation.
pub(super) fn open_pair(state: &AppState, prefix: &str) -> (TempDir, String, u64) {
    let dir = dir_named(prefix);
    let bytes: Vec<u8> = (0..LEN).map(|i| (i * 7) as u8).collect();
    for (name, bytes) in [("a", &bytes[..]), ("b", &bytes[..]), ("c", &bytes[1..])] {
        let path = dir.path().join(name);
        fs::write(&path, bytes).unwrap();
        settle(&path);
    }
    let tree = scanned(dir.path());
    let root = tree.name(0).to_owned();
    let generation = state.install_tree(tree);
    (dir, root, generation)
}

fn recorder() -> (Emit, Arc<Mutex<Vec<StatusDto>>>) {
    let log = Arc::new(Mutex::new(Vec::new()));
    let into = log.clone();
    let emit: Emit = Arc::new(move |s| into.lock().unwrap().push(s));
    (emit, log)
}

/// Runs a job with no query to its end.
fn find(state: &AppState, emit: Emit) -> u64 {
    let (job, handle) = state.find_duplicates(String::new(), false, emit).unwrap();
    handle.join().unwrap();
    job
}

fn keys(dto: &DuplicatesDto) -> Vec<String> {
    dto.groups.iter().map(|g| g.key.clone()).collect()
}

#[test]
fn a_finished_search_is_kept_until_the_next_find() {
    let (state, _) = state();
    let _dir = open_pair(&state, "kept");
    let job = find(&state, recorder().0);
    let first = state.duplicates_since(0, 0);
    let second = state.duplicates_since(0, 0);
    for dto in [&first, &second] {
        assert_eq!(dto.job, job);
        assert!(!dto.running && dto.complete && !dto.stale && dto.full);
        assert_eq!(dto.groups.len(), 1);
        assert_eq!(dto.groups[0].copies.len(), 2);
        assert_eq!(dto.groups[0].len, LEN as u64);
    }
    assert_eq!(keys(&first), keys(&second));
    assert_eq!(first.version, second.version);
    assert_eq!(state.0.duplicates.inner.lock().unwrap().next_job, 1);
}

#[test]
fn estimate_reads_no_file() {
    let (state, calls) = state();
    let (_dir, _, _) = open_pair(&state, "estimate");
    for _ in 0..3 {
        let e = state.estimate_duplicates("", false);
        assert_eq!((e.files, e.bytes, e.roots), (2, 2 * LEN as u64, 1));
        assert!(e.skipped.is_empty());
    }
    assert_eq!(state.0.duplicates.cache.lock().unwrap().len(), 0);
    assert!(calls.load(Ordering::SeqCst) <= 1);
}

#[test]
fn a_tree_change_does_not_wait_for_a_search() {
    let (state, _) = state();
    let (_dir, root, generation) = open_pair(&state, "change");
    let changer = state.clone();
    let waited = Arc::new(Mutex::new(None));
    let result = waited.clone();
    let started = AtomicBool::new(false);
    let emit: Emit = Arc::new(move |_| {
        if started.swap(true, Ordering::SeqCst) {
            return;
        }
        let (tx, rx) = mpsc::channel();
        let (changer, root) = (changer.clone(), root.clone());
        thread::spawn(move || {
            changer.remove_trashed(&root, generation, &[], None);
            let _ = tx.send(());
        });
        *result.lock().unwrap() = Some(rx.recv_timeout(Duration::from_secs(5)));
    });
    find(&state, emit);
    assert_eq!(*waited.lock().unwrap(), Some(Ok(())));
}

#[test]
fn a_resumed_search_starts_with_the_old_groups() {
    let (state, _) = state();
    let _dir = open_pair(&state, "resumed");
    // Cancelled once a group is in: at the latest by the last progress, before the job ends.
    let canceller = state.clone();
    let stop: Emit = Arc::new(move |s| {
        if s.running && s.version > 0 {
            canceller.cancel_duplicates();
        }
    });
    find(&state, stop);
    let stopped = state.duplicates_since(0, 0);
    assert!(!stopped.complete);
    assert_eq!(stopped.groups.len(), 1);
    // "Continue": the new job is held at its first progress, before it reads any content.
    let (started, at_start) = mpsc::channel();
    let (go, wait) = mpsc::channel::<()>();
    let gate = Mutex::new(Some((started, wait)));
    let hold: Emit = Arc::new(move |_| {
        if let Some((started, wait)) = gate.lock().unwrap().take() {
            started.send(()).unwrap();
            wait.recv_timeout(HANG).unwrap();
        }
    });
    let (job, handle) = state.find_duplicates(String::new(), false, hold).unwrap();
    at_start.recv_timeout(HANG).unwrap();
    let resumed = state.duplicates_since(0, 0);
    assert_eq!(resumed.job, job);
    assert!(resumed.running);
    assert_eq!(keys(&resumed), keys(&stopped));
    go.send(()).unwrap();
    handle.join().unwrap();
    let done = state.duplicates_since(0, 0);
    assert!(done.complete && !done.running);
    assert_eq!(keys(&done), keys(&stopped));
}

#[test]
fn a_resumed_search_of_another_query_starts_empty() {
    let (state, _) = state();
    let _dir = open_pair(&state, "requery");
    find(&state, recorder().0);
    let (started, at_start) = mpsc::channel();
    let (go, wait) = mpsc::channel::<()>();
    let gate = Mutex::new(Some((started, wait)));
    let hold: Emit = Arc::new(move |_| {
        if let Some((started, wait)) = gate.lock().unwrap().take() {
            started.send(()).unwrap();
            wait.recv_timeout(HANG).unwrap();
        }
    });
    let (_, handle) = state.find_duplicates("a".into(), false, hold).unwrap();
    at_start.recv_timeout(HANG).unwrap();
    assert!(state.duplicates_since(0, 0).groups.is_empty());
    go.send(()).unwrap();
    handle.join().unwrap();
}

#[test]
fn find_during_a_trash_is_busy() {
    let (state, _) = state();
    let _dir = open_pair(&state, "busy");
    state.0.duplicates.trashing.store(1, Ordering::SeqCst);
    let (emit, statuses) = recorder();
    let found = state.find_duplicates(String::new(), false, emit);
    assert_eq!(found.err(), Some(CmdError::Busy));
    assert!(statuses.lock().unwrap().is_empty());
    assert_eq!(state.duplicates_since(0, 0).job, 0);
    assert!(!state.duplicates_running());
}

#[test]
fn roots_being_scanned_are_skipped() {
    let (state, _) = state();
    let (_dir, root, _) = open_pair(&state, "scanning");
    state.enqueue(root.clone()).unwrap();
    let e = state.estimate_duplicates("", false);
    assert_eq!(e.skipped, [root]);
    assert_eq!((e.files, e.roots), (0, 0));
}

#[test]
fn a_rescan_marks_the_result_stale() {
    let (state, _) = state();
    let (dir, _, _) = open_pair(&state, "rescan");
    find(&state, recorder().0);
    assert!(!state.duplicates_since(0, 0).stale);
    assert!(!state.duplicates_stale());
    state.install_tree(scanned(dir.path()));
    assert!(state.duplicates_since(0, 0).stale);
    assert!(state.duplicates_stale());
}

#[test]
fn opening_another_root_marks_the_result_stale() {
    let (state, _) = state();
    let _dir = open_pair(&state, "first");
    find(&state, recorder().0);
    let other = dir_named("other");
    state.install_tree(scanned(other.path()));
    assert!(state.duplicates_since(0, 0).stale);
}

#[test]
fn a_new_find_replaces_the_old_job() {
    let (state, _) = state();
    let _dir = open_pair(&state, "replace");
    let (first, statuses) = recorder();
    let (job1, h1) = state.find_duplicates(String::new(), false, first).unwrap();
    let (job2, h2) = state
        .find_duplicates(String::new(), false, recorder().0)
        .unwrap();
    h1.join().unwrap();
    h2.join().unwrap();
    assert_eq!(job2, job1 + 1);
    assert!(statuses.lock().unwrap().iter().all(|s| s.job == job1));
    let results = state.0.duplicates.inner.lock().unwrap();
    assert_eq!(results.results.as_ref().unwrap().job, job2);
    drop(results);
    let dto = state.duplicates_since(job1, 1);
    assert!(dto.full && dto.complete && !dto.running);
    assert_eq!(dto.job, job2);
    assert_eq!(dto.groups.len(), 1);
}

#[test]
fn every_status_of_a_job_carries_its_id() {
    let (state, _) = state();
    let _dir = open_pair(&state, "status");
    let (emit, statuses) = recorder();
    let job = find(&state, emit);
    let statuses = statuses.lock().unwrap();
    let (last, before) = statuses.split_last().expect("statuses");
    assert!(statuses.iter().all(|s| s.job == job));
    assert!(before.iter().all(|s| s.running));
    assert!(!last.running);
    assert_eq!(last.version, state.duplicates_since(0, 0).version);
    assert!(!state.duplicates_running());
}
