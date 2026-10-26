use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

fn on_volumes() -> AppState {
    AppState::with_volumes(Arc::new(|root| {
        let volume = if root.starts_with("/v1") { "v1" } else { "v2" };
        volume.to_owned()
    }))
}

#[test]
fn writes_of_two_roots_do_not_wait_for_each_other() {
    let state = AppState::default();
    let _a = ready(state.begin_write("/a")).unwrap().unwrap();
    assert!(ready(state.begin_write("/b")).unwrap().is_ok());
    assert!(ready(state.begin_write("/a")).is_none());
}

#[test]
fn a_scan_write_waits_for_the_turn_of_its_volume() {
    let state = on_volumes();
    let _trash = ready(state.volume_turn("v1")).unwrap();
    assert!(ready(state.begin_scan_write("/v1/a")).is_none());
    assert!(ready(state.begin_scan_write("/v2/b")).is_some());
}

#[cfg(unix)]
#[test]
fn an_unknown_volume_is_the_root_itself() {
    let root = Path::new("/no/such/root-sizeatlas");
    assert_eq!(default_volume_of()(root), "/no/such/root-sizeatlas");
}

#[test]
fn a_reserved_turn_keeps_its_place() {
    let state = AppState::default();
    let holder = ready(state.volume_turn("v")).unwrap();
    let t2 = Turn::reserve(state.volume_turn("v"));
    let t3 = Turn::reserve(state.volume_turn("v"));
    drop(holder);
    assert!(
        ready(t3.wait()).is_none(),
        "the third waits behind the second"
    );
    assert!(ready(t2.wait()).is_some());
}

#[test]
fn the_volume_of_a_root_is_asked_once() {
    let asked = Arc::new(AtomicUsize::new(0));
    let counted = asked.clone();
    let state = AppState::with_volumes(Arc::new(move |_| {
        counted.fetch_add(1, Ordering::Relaxed);
        "v".to_owned()
    }));
    assert_eq!(state.volume_of("/r"), "v");
    assert_eq!(state.volume_of("/r"), "v");
    assert_eq!(asked.load(Ordering::Relaxed), 1);
}
