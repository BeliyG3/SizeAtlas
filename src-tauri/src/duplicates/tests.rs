//! The search service on real files in a temporary folder: jobs, their statuses, the kept
//! result, staleness, and that nothing waits for a search.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};

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

pub(super) fn state() -> (AppState, Arc<AtomicUsize>) {
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

pub(super) fn recorder() -> (Emit, Arc<Mutex<Vec<StatusDto>>>) {
    let log = Arc::new(Mutex::new(Vec::new()));
    let into = log.clone();
    let emit: Emit = Arc::new(move |s| into.lock().unwrap().push(s));
    (emit, log)
}

/// Runs a job with no query to its end.
pub(super) fn find(state: &AppState, emit: Emit) -> u64 {
    let (job, handle) = state
        .find_duplicates(String::new(), false, None, emit)
        .unwrap();
    handle.join().unwrap();
    job
}

/// Holds the first caller of `wait` until `go` is sent, after telling `entered`; later callers
/// pass.
pub(super) struct Hold(Mutex<Option<(Sender<()>, Receiver<()>)>>);

impl Hold {
    /// The hold, `entered` and `go`.
    pub(super) fn new() -> (Hold, Receiver<()>, Sender<()>) {
        let (entered, at) = mpsc::channel();
        let (go, wait) = mpsc::channel();
        (Hold(Mutex::new(Some((entered, wait)))), at, go)
    }

    pub(super) fn wait(&self) {
        let first = self.0.lock().unwrap().take();
        if let Some((entered, go)) = first {
            entered.send(()).unwrap();
            go.recv_timeout(HANG).unwrap();
        }
    }
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
        let e = state.estimate_duplicates("", false, None).unwrap();
        assert_eq!((e.files, e.bytes, e.roots), (2, 2 * LEN as u64, 1));
        assert!(e.skipped.is_empty());
    }
    assert_eq!(state.0.duplicates.cache.lock().unwrap().len(), 0);
    assert!(calls.load(Ordering::SeqCst) <= 1);
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
    let (hold, at_start, go) = Hold::new();
    let hold: Emit = Arc::new(move |_| hold.wait());
    let (job, handle) = state
        .find_duplicates(String::new(), false, None, hold)
        .unwrap();
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
    let (hold, at_start, go) = Hold::new();
    let hold: Emit = Arc::new(move |_| hold.wait());
    let (_, handle) = state
        .find_duplicates("a".into(), false, None, hold)
        .unwrap();
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
    let found = state.find_duplicates(String::new(), false, None, emit);
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
    let e = state.estimate_duplicates("", false, None).unwrap();
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
    // Job 1 is held at its first progress while job 2 runs to its end.
    let (statuses, log) = recorder();
    let (hold, entered, go) = Hold::new();
    let first: Emit = Arc::new(move |s| {
        statuses(s);
        hold.wait();
    });
    let (job1, h1) = state
        .find_duplicates(String::new(), false, None, first)
        .unwrap();
    entered.recv_timeout(HANG).unwrap();
    let job2 = find(&state, recorder().0);
    assert_eq!(job2, job1 + 1);
    let before = state.duplicates_since(0, 0);
    go.send(()).unwrap();
    h1.join().unwrap();
    // Job 1 went on after it was replaced, and sent and changed nothing more.
    assert_eq!(log.lock().unwrap().len(), 1);
    assert_eq!(log.lock().unwrap()[0].job, job1);
    let results = state.0.duplicates.inner.lock().unwrap();
    assert_eq!(results.results.as_ref().unwrap().job, job2);
    assert_eq!(results.status.job, job2);
    drop(results);
    let dto = state.duplicates_since(job1, 1);
    assert!(dto.full && dto.complete && !dto.running);
    assert_eq!((dto.job, dto.version), (job2, before.version));
    assert_eq!(dto.groups.len(), 1);
}
