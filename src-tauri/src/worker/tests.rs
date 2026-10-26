use std::fs;
use std::sync::Mutex;

use tempfile::TempDir;

use super::*;
use crate::dto::QueueState;
use crate::exit::ExitDecision;
use crate::sources;

fn folder() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.bin"), vec![0u8; 5000]).unwrap();
    dir
}

pub(super) fn root_of(dir: &TempDir) -> String {
    dunce::canonicalize(dir.path())
        .unwrap()
        .display()
        .to_string()
}

fn open_roots(state: &AppState) -> Vec<String> {
    state.summaries().into_iter().map(|s| s.root).collect()
}

fn queue_of(state: &AppState) -> Vec<(String, QueueState)> {
    state
        .roots()
        .queue
        .into_iter()
        .map(|q| (q.root, q.state))
        .collect()
}

/// Runs the queue from `job` until it is empty; returns the notices other than progress.
pub(super) fn run_queue(state: &AppState, cache: &Path, job: Option<ScanJob>) -> Vec<String> {
    let log = Arc::new(Mutex::new(Vec::new()));
    let sink = log.clone();
    let notify: Notify = Arc::new(move |notice| {
        let line = match notice {
            Notice::RootsChanged | Notice::LiveChanged => "changed".to_owned(),
            Notice::Progress(_) => return,
            Notice::Failed { error, .. } => format!("failed: {error:?}"),
        };
        sink.lock().unwrap().push(line);
    });
    if let Some(job) = job {
        tauri::async_runtime::block_on(run(state.clone(), cache.to_path_buf(), job, notify));
    }
    log.lock().unwrap().clone()
}

#[test]
fn queued_roots_are_scanned_one_at_a_time_in_order() {
    let (a, b, c, cache) = (folder(), folder(), folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let job = state.enqueue(root_of(&a)).unwrap();
    for dir in [&b, &c, &a, &b] {
        assert!(state.enqueue(root_of(dir)).unwrap().is_none());
    }
    assert_eq!(
        queue_of(&state),
        [
            (root_of(&a), QueueState::Scanning),
            (root_of(&b), QueueState::Queued),
            (root_of(&c), QueueState::Queued),
        ]
    );
    let log = run_queue(&state, cache.path(), job);
    assert!(log.iter().all(|l| l == "changed"), "{log:?}");
    assert_eq!(open_roots(&state), [root_of(&a), root_of(&b), root_of(&c)]);
    assert!(queue_of(&state).is_empty());
    assert_eq!(sources::cached_scans(cache.path()).len(), 3);
}

#[test]
fn a_rescan_replaces_the_root_in_place_and_stales_its_old_ids() {
    let (a, b, cache) = (folder(), folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let job = state.enqueue(root_of(&a)).unwrap();
    state.enqueue(root_of(&b)).unwrap();
    run_queue(&state, cache.path(), job);
    let old = state.summaries()[0].generation;
    fs::write(a.path().join("new.bin"), vec![0u8; 100]).unwrap();
    run_queue(&state, cache.path(), state.enqueue(root_of(&a)).unwrap());
    assert_eq!(open_roots(&state), [root_of(&a), root_of(&b)]);
    let rescanned = &state.summaries()[0];
    assert!(rescanned.generation > old);
    assert_eq!(rescanned.files, 2);
    assert_eq!(state.summary(old), Err(CmdError::StaleId));
}

#[test]
fn closing_by_root_works_after_a_rescan_replaced_the_tree() {
    let (a, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    run_queue(&state, cache.path(), state.enqueue(root_of(&a)).unwrap());
    let shown = state.summaries()[0].generation;
    run_queue(&state, cache.path(), state.enqueue(root_of(&a)).unwrap());
    assert!(
        state.summaries()[0].generation > shown,
        "the UI still shows the old generation"
    );
    jobs::close_root(&state, &root_of(&a));
    assert!(state.summaries().is_empty());
}

#[test]
fn cancelling_the_running_scan_keeps_the_root_as_it_was() {
    let (a, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    run_queue(&state, cache.path(), state.enqueue(root_of(&a)).unwrap());
    let before = state.summaries()[0].generation;
    let job = state.enqueue(root_of(&a)).unwrap();
    assert!(!state.cancel_scan(None));
    let log = run_queue(&state, cache.path(), job);
    assert!(
        log.iter().all(|l| l == "changed"),
        "a cancel is not a failure: {log:?}"
    );
    assert_eq!(state.summaries()[0].generation, before);
}

#[test]
fn cancelling_a_queued_root_drops_only_that_root() {
    let (a, b, c, cache) = (folder(), folder(), folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let job = state.enqueue(root_of(&a)).unwrap();
    state.enqueue(root_of(&b)).unwrap();
    state.enqueue(root_of(&c)).unwrap();
    assert!(state.cancel_scan(Some(&root_of(&b))));
    run_queue(&state, cache.path(), job);
    assert_eq!(open_roots(&state), [root_of(&a), root_of(&c)]);
}

#[test]
fn a_scan_that_ends_after_its_root_is_closed_does_not_reopen_it() {
    let (a, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    run_queue(&state, cache.path(), state.enqueue(root_of(&a)).unwrap());
    let job = state.enqueue(root_of(&a)).unwrap().unwrap();
    // The walk has ended, the tree is about to be installed: now the root is closed.
    let tree = jobs::walk(&job).unwrap().expect("not cancelled yet");
    jobs::close_root(&state, &root_of(&a));
    assert!(
        state
            .install_scan(Arc::new(tree), &job.discard, true)
            .is_none(),
        "a closed root is not installed again"
    );
    assert!(state.summaries().is_empty());
}

#[test]
fn closing_the_app_after_a_walk_still_installs_and_saves_it() {
    let (a, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let job = state.enqueue(root_of(&a)).unwrap().unwrap();
    let tree = jobs::walk(&job).unwrap().expect("not cancelled yet");
    let write = tauri::async_runtime::block_on(state.begin_scan_write(&job.root)).unwrap();
    assert_eq!(state.on_exit_request(), ExitDecision::PreventAndWait);
    assert!(job.cancelled(), "closing stops the walk");
    let notify: Notify = Arc::new(|_| {});
    install_and_save(&state, cache.path(), &job, tree, write, &notify).unwrap();
    assert_eq!(open_roots(&state), [root_of(&a)]);
    assert_eq!(sources::cached_scans(cache.path()).len(), 1);
}

#[test]
fn closing_a_root_drops_its_queued_rescan() {
    let (a, b, cache) = (folder(), folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    run_queue(&state, cache.path(), state.enqueue(root_of(&a)).unwrap());
    let job = state.enqueue(root_of(&b)).unwrap();
    state.enqueue(root_of(&a)).unwrap();
    jobs::close_root(&state, &root_of(&a));
    assert_eq!(queue_of(&state), [(root_of(&b), QueueState::Scanning)]);
    run_queue(&state, cache.path(), job);
    assert_eq!(open_roots(&state), [root_of(&b)]);
}

#[test]
fn forgetting_a_root_drops_its_queued_scan_and_its_saved_scan() {
    let (a, b, cache) = (folder(), folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    run_queue(&state, cache.path(), state.enqueue(root_of(&a)).unwrap());
    let job = state.enqueue(root_of(&b)).unwrap();
    state.enqueue(root_of(&a)).unwrap();
    jobs::forget(&state, cache.path(), &root_of(&a)).unwrap();
    assert_eq!(queue_of(&state), [(root_of(&b), QueueState::Scanning)]);
    assert!(state.summaries().is_empty());
    assert!(sources::cached_scans(cache.path()).is_empty());
    run_queue(&state, cache.path(), job);
    assert_eq!(open_roots(&state), [root_of(&b)]);
    assert_eq!(sources::cached_scans(cache.path()).len(), 1);
}

#[test]
fn a_failed_scan_is_reported_and_the_queue_goes_on() {
    let (b, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let missing = cache.path().join("nope").display().to_string();
    let job = state.enqueue(missing).unwrap();
    state.enqueue(root_of(&b)).unwrap();
    let log = run_queue(&state, cache.path(), job);
    assert!(log.iter().any(|l| l.starts_with("failed: Io")), "{log:?}");
    assert_eq!(open_roots(&state), [root_of(&b)]);
}

#[test]
fn an_unsaved_scan_stays_open_and_is_reported() {
    let root = folder();
    let not_a_dir = tempfile::NamedTempFile::new().unwrap();
    let state = AppState::default();
    let log = run_queue(
        &state,
        not_a_dir.path(),
        state.enqueue(root_of(&root)).unwrap(),
    );
    assert!(log.contains(&"failed: CacheNotSaved".to_owned()), "{log:?}");
    assert_eq!(open_roots(&state), [root_of(&root)]);
}

#[test]
fn opening_does_not_wait_for_a_scan_nor_closing_for_a_write() {
    let (a, b, cache) = (folder(), folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    run_queue(&state, cache.path(), state.enqueue(root_of(&a)).unwrap());
    jobs::close_root(&state, &root_of(&a));
    let _scanning = state.enqueue(root_of(&b)).unwrap();
    let opening = jobs::open_cached_waiting(state.clone(), cache.path().into(), root_of(&a));
    let summary = tauri::async_runtime::block_on(opening).unwrap();
    let _saving = tauri::async_runtime::block_on(state.begin_write(&summary.root)).unwrap();
    jobs::close_root(&state, &summary.root);
    assert!(state.summaries().is_empty());
}

#[test]
fn a_queued_scan_waits_for_a_trash_that_runs() {
    let (a, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    // A trash holds the turn of its volume from its check to its saved scan.
    let trashing =
        tauri::async_runtime::block_on(state.volume_turn(&state.volume_of(&root_of(&a))));
    let job = state.enqueue(root_of(&a)).unwrap();
    let progress = job.as_ref().unwrap().progress.clone();
    let (worker_state, dir) = (state.clone(), cache.path().to_path_buf());
    let worker = std::thread::spawn(move || run_queue(&worker_state, &dir, job));
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(
        progress.files.load(Ordering::Relaxed),
        0,
        "the walk has not started"
    );
    drop(trashing);
    worker.join().unwrap();
    assert_eq!(open_roots(&state), [root_of(&a)]);
}

#[test]
fn a_scan_does_not_wait_for_a_trash_on_another_volume() {
    let (a, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::with_volumes(Arc::new(|_| "x".to_owned()));
    let _trashing = tauri::async_runtime::block_on(state.volume_turn("y"));
    let job = state.enqueue(root_of(&a)).unwrap();
    let (done, scanned) = std::sync::mpsc::channel();
    let (worker_state, dir) = (state.clone(), cache.path().to_path_buf());
    std::thread::spawn(move || done.send(run_queue(&worker_state, &dir, job)));
    // A safety net only: the scan never waits for the trash on "y".
    scanned
        .recv_timeout(Duration::from_secs(10))
        .expect("the scan waited for a trash on another volume");
    assert_eq!(open_roots(&state), [root_of(&a)]);
}
