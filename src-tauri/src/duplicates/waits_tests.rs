//! Nothing a search does makes a change of a tree wait: no tree is held across a question
//! (the volume of a root, the context), a second read of the roots, or the search itself.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use super::Emit;
use super::tests::{Hold, counting, find, open_pair, state};
use crate::cleanup::ContextFn;
use crate::recycle::fixture::HANG;
use crate::state::AppState;
use crate::writes::VolumeFn;

/// Changes the tree of `root` on another thread; how long it may take is bounded, so a change
/// that waits for a held tree fails the test instead of hanging it.
fn change_within(state: &AppState, root: &str, generation: u64) -> Result<(), RecvTimeoutError> {
    let (done, changed) = mpsc::channel();
    let (state, root) = (state.clone(), root.to_owned());
    thread::spawn(move || {
        state.remove_trashed(&root, generation, &[], None);
        let _ = done.send(());
    });
    changed.recv_timeout(Duration::from_secs(5))
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
        if !started.swap(true, Ordering::SeqCst) {
            *result.lock().unwrap() = Some(change_within(&changer, &root, generation));
        }
    });
    find(&state, emit);
    assert_eq!(*waited.lock().unwrap(), Some(Ok(())));
}

#[test]
fn a_tree_change_does_not_wait_for_the_volume_of_another_root() {
    // The volume of the second root is asked while the first one changes.
    let (hold, entered, go) = Hold::new();
    let volume_of: VolumeFn = Arc::new(move |root: &Path| {
        if root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("held")
        {
            hold.wait();
        }
        "v".to_owned()
    });
    let state = AppState::with_context_and_volumes(counting().0, volume_of);
    let (_a, root, generation) = open_pair(&state, "free");
    let _b = open_pair(&state, "held");
    let picking = state.clone();
    let estimate = thread::spawn(move || picking.estimate_duplicates("", false));
    entered.recv_timeout(HANG).unwrap();
    let changed = change_within(&state, &root, generation);
    go.send(()).unwrap();
    assert_eq!(changed, Ok(()));
    assert_eq!(estimate.join().unwrap().roots, 2);
}

#[test]
fn a_tree_change_does_not_wait_for_the_context() {
    let (hold, entered, go) = Hold::new();
    let (known, _) = counting();
    let context: ContextFn = Arc::new(move |root: &Path| {
        hold.wait();
        known(root)
    });
    let state = AppState::with_context(context);
    let (_dir, root, generation) = open_pair(&state, "context");
    let picking = state.clone();
    let estimate = thread::spawn(move || picking.estimate_duplicates("", false));
    entered.recv_timeout(HANG).unwrap();
    let changed = change_within(&state, &root, generation);
    go.send(()).unwrap();
    assert_eq!(changed, Ok(()));
    assert_eq!(estimate.join().unwrap().roots, 1);
}
