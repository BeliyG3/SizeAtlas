use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Barrier, mpsc};
use std::thread;

use tauri::async_runtime::block_on;

use super::*;
use crate::exit::ExitDecision;
use crate::recycle::fixture::HANG;

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

fn names(names: &[&str]) -> Vec<String> {
    names.iter().map(|n| (*n).to_owned()).collect()
}

/// Polls the pinned `f` once: `None` while it waits. Unlike [`ready`] it keeps the future, so
/// the places it took in the queues stay.
fn poll<F: Future>(f: Pin<&mut F>) -> Option<F::Output> {
    match f.poll(&mut Context::from_waker(Waker::noop())) {
        Poll::Ready(out) => Some(out),
        Poll::Pending => None,
    }
}

#[test]
fn reserved_turns_queue_two_batches_in_one_order() {
    let state = AppState::default();
    let holder = ready(state.volume_turn("a")).unwrap();
    let x = state.reserve_turns(&names(&["b", "a"]));
    let y = state.reserve_turns(&names(&["a", "b"]));
    let mut x = std::pin::pin!(wait_turns(x, || false));
    let mut y = std::pin::pin!(wait_turns(y, || false));
    assert!(poll(x.as_mut()).is_none(), "a is held");
    assert!(poll(y.as_mut()).is_none());
    drop(holder);
    let x_got = poll(x.as_mut()).expect("x has both turns");
    let x_got = x_got.expect("not stopped");
    assert_eq!(x_got.len(), 2);
    assert!(poll(y.as_mut()).is_none(), "y has none of them");
    drop(x_got);
    let y_got = poll(y.as_mut()).expect("y has both turns");
    assert_eq!(y_got.expect("not stopped").len(), 2);
}

#[test]
fn a_stopped_wait_lets_its_turns_go() {
    let state = AppState::default();
    let holder = ready(state.volume_turn("b")).unwrap();
    let stop = AtomicBool::new(false);
    let turns = state.reserve_turns(&names(&["a", "b"]));
    let mut batch = std::pin::pin!(wait_turns(turns, || stop.load(Ordering::SeqCst)));
    assert!(poll(batch.as_mut()).is_none());
    assert!(ready(state.volume_turn("a")).is_none(), "the batch has a");
    stop.store(true, Ordering::SeqCst);
    drop(holder);
    assert!(poll(batch.as_mut()).expect("ends").is_none(), "stopped");
    assert!(ready(state.volume_turn("a")).is_some());
    assert!(ready(state.volume_turn("b")).is_some());
}

#[test]
fn a_write_of_two_roots_holds_the_exit() {
    let state = AppState::default();
    let write = ready(state.begin_writes(&names(&["/b", "/a", "/b"])))
        .unwrap()
        .unwrap();
    assert!(ready(state.begin_write("/a")).is_none());
    assert!(ready(state.begin_write("/b")).is_none());
    assert_eq!(state.on_exit_request(), ExitDecision::PreventAndWait);
    drop(write);
    block_on(state.wait_until_idle());
    assert_eq!(state.on_exit_request(), ExitDecision::Allow);
}

type Step = Box<dyn FnOnce(&AppState) + Send>;

/// A batch as `requests::run_batch` takes its locks: every turn at once, then the writes.
fn batch(volumes: &'static [&'static str], roots: &'static [&'static str]) -> Step {
    Box::new(move |state: &AppState| {
        let turns = state.reserve_turns(&names(volumes));
        block_on(async {
            let Some(_turns) = wait_turns(turns, || false).await else {
                return;
            };
            let _write = state.begin_writes(&names(roots)).await;
        });
    })
}

#[test]
fn two_batches_an_ordinary_request_a_scan_write_and_an_exit_all_end() {
    for _ in 0..20 {
        let state = on_volumes();
        let steps: Vec<Step> = vec![
            batch(&["v1", "v2", "v1"], &["/v1/a", "/v2/b", "/v1/a"]),
            batch(&["v2", "v1"], &["/v2/b", "/v1/a"]),
            Box::new(|state| {
                let turn = Turn::reserve(state.volume_turn("v2"));
                block_on(async {
                    let _turn = turn.wait().await;
                    let _write = state.begin_write("/v2/b").await;
                });
            }),
            Box::new(|state| drop(block_on(state.begin_scan_write("/v1/a")))),
            Box::new(|state| block_on(state.volume_idle("/v2/b"))),
            Box::new(|state| {
                if state.on_exit_request() == ExitDecision::PreventAndWait {
                    block_on(state.wait_until_idle());
                }
            }),
        ];
        let barrier = Arc::new(Barrier::new(steps.len()));
        let (done, ended) = mpsc::channel();
        let count = steps.len();
        for step in steps {
            let (state, barrier, done) = (state.clone(), barrier.clone(), done.clone());
            thread::spawn(move || {
                barrier.wait();
                step(&state);
                done.send(()).unwrap();
            });
        }
        for _ in 0..count {
            ended.recv_timeout(HANG).expect("everything ends");
        }
        assert_eq!(state.on_exit_request(), ExitDecision::Allow);
    }
}
