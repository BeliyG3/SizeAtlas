//! The progress of a trash request and its stop.

use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use super::fixture::{anywhere, deleting, id, open, real};
use super::{Pacer, run_reporting};
use crate::dto::TrashProgressDto;
use crate::sources;
use crate::state::AppState;

#[test]
fn progress_comes_at_once_then_at_most_ten_times_a_second() {
    let mut pacer = Pacer::default();
    let start = Instant::now();
    let at = |ms| start + Duration::from_millis(ms);
    assert!(pacer.due(at(0)), "the first item at once");
    assert!(!pacer.due(at(50)));
    assert!(pacer.due(at(100)));
    assert!(!pacer.due(at(199)));
    // 10 000 items in 10 seconds: one report per 100 ms.
    let mut pacer = Pacer::default();
    let reports = (0..10_000).filter(|&ms| pacer.due(at(ms))).count();
    assert_eq!(reports, 100);
}

#[test]
fn progress_names_the_first_item_and_ends_with_all_of_them() {
    let state = AppState::default();
    let (_dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let ids = [
        id(&state, generation, &["top.bin"]),
        id(&state, generation, &["sub", "x.bin"]),
        id(&state, generation, &["sub", "y.bin"]),
    ];
    let mut events = Vec::new();
    let done = run_reporting(
        &state,
        cache.path(),
        generation,
        0,
        &ids,
        anywhere,
        deleting(&log),
        &|| false,
        |p| events.push(p),
    )
    .unwrap();
    assert_eq!((done.removed, done.stopped), (3, false));
    let first = log.lock().unwrap()[0].display().to_string();
    assert_eq!(
        events.first(),
        Some(&TrashProgressDto {
            done: 0,
            total: 3,
            current: Some(first),
            rehash: None,
        })
    );
    assert_eq!(
        events.last(),
        Some(&TrashProgressDto {
            done: 3,
            total: 3,
            current: None,
            rehash: None,
        })
    );
    assert!(events.windows(2).all(|w| w[0].done <= w[1].done));
    assert!((2..=4).contains(&events.len()), "paced: {events:?}");
}

#[test]
fn a_stop_keeps_what_went_and_leaves_the_rest() {
    let state = AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let ids = [
        id(&state, generation, &["top.bin"]),
        id(&state, generation, &["sub", "x.bin"]),
        id(&state, generation, &["sub", "y.bin"]),
    ];
    let deletes = deleting(&log);
    let stop = AtomicBool::new(false);
    // The user presses Stop while the first item moves.
    let stopping = |path: &Path| {
        stop.store(true, Ordering::Relaxed);
        deletes(path)
    };
    let mut events = Vec::new();
    let done = run_reporting(
        &state,
        cache.path(),
        generation,
        0,
        &ids,
        anywhere,
        stopping,
        &|| stop.load(Ordering::Relaxed),
        |p| events.push(p),
    )
    .unwrap();
    assert_eq!(
        (done.removed, done.failed.len(), done.stopped),
        (1, 0, true)
    );
    let moved = log.lock().unwrap().clone();
    assert_eq!(moved.len(), 1);
    let paths = [
        real(&dir, &["top.bin"]),
        real(&dir, &["sub", "x.bin"]),
        real(&dir, &["sub", "y.bin"]),
    ];
    for path in paths.iter().filter(|p| !moved.contains(p)) {
        assert!(path.exists(), "{path:?} stays");
    }
    assert_eq!(state.summaries()[0].files, 2, "the tree lost only that one");
    assert_eq!(
        sources::cached_scans(cache.path())[0].files,
        2,
        "the saved scan too"
    );
    assert_eq!(
        events.last().map(|p| (p.done, p.total)),
        Some((1, 3)),
        "the end says how far it got"
    );
}

#[test]
fn a_stop_before_the_first_item_moves_nothing() {
    let state = AppState::default();
    let (_dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let top = id(&state, generation, &["top.bin"]);
    let stop = AtomicBool::new(true);
    let stopped = || stop.load(Ordering::Relaxed);
    let done = run_reporting(
        &state,
        cache.path(),
        generation,
        0,
        &[top],
        anywhere,
        deleting(&log),
        &stopped,
        |_| (),
    )
    .unwrap();
    assert_eq!((done.removed, done.stopped), (0, true));
    assert!(log.lock().unwrap().is_empty());
    stop.store(false, Ordering::Relaxed);
    let again = run_reporting(
        &state,
        cache.path(),
        generation,
        0,
        &[top],
        anywhere,
        deleting(&log),
        &stopped,
        |_| (),
    );
    assert_eq!(again.map(|d| (d.removed, d.stopped)), Ok((1, false)));
}
