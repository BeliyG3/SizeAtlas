use super::*;

fn write(state: &AppState) -> Result<OwnedMutexGuard<()>, CmdError> {
    tauri::async_runtime::block_on(state.begin_write())
}

#[test]
fn idle_app_closes_and_refuses_new_work() {
    let state = AppState::default();
    assert_eq!(state.on_exit_request(), ExitDecision::Allow);
    assert!(matches!(state.enqueue("/a".into()), Err(CmdError::Busy)));
    assert!(matches!(write(&state), Err(CmdError::Busy)));
}

#[test]
fn closing_cancels_the_scan_and_drops_the_queue_without_waiting() {
    let state = AppState::default();
    let job = state.enqueue("/a".into()).unwrap().unwrap();
    state.enqueue("/b".into()).unwrap();
    assert_eq!(
        state.on_exit_request(),
        ExitDecision::Allow,
        "a scan without a write does not delay the exit"
    );
    assert!(job.cancelled());
    assert!(state.next_scan().is_none(), "the waiting root is dropped");
}

#[test]
fn a_write_in_progress_delays_the_exit() {
    let state = AppState::default();
    let saving = write(&state).unwrap();
    assert_eq!(state.on_exit_request(), ExitDecision::PreventAndWait);
    assert_eq!(
        state.on_exit_request(),
        ExitDecision::Prevent,
        "a second close while waiting"
    );
    assert!(matches!(state.enqueue("/a".into()), Err(CmdError::Busy)));
    drop(saving);
    tauri::async_runtime::block_on(state.wait_until_idle());
    assert_eq!(state.on_exit_request(), ExitDecision::Allow);
}

#[test]
fn a_waiting_write_is_refused_once_closing() {
    let state = AppState::default();
    let saving = write(&state).unwrap();
    let other = state.clone();
    // Waits for `busy` (or gets there after the exit decision): either way it must not write.
    let waiting = std::thread::spawn(move || write(&other).map(drop));
    assert_eq!(state.on_exit_request(), ExitDecision::PreventAndWait);
    drop(saving);
    assert_eq!(waiting.join().unwrap(), Err(CmdError::Busy));
    tauri::async_runtime::block_on(state.wait_until_idle());
    assert_eq!(state.on_exit_request(), ExitDecision::Allow);
}

#[test]
fn exit_fallback_does_not_wait_once_allowed() {
    let state = AppState::default();
    assert_eq!(state.on_exit_request(), ExitDecision::Allow);
    let _held = state.0.busy.try_lock().unwrap();
    let (done, finished) = std::sync::mpsc::channel();
    let worker = state.clone();
    std::thread::spawn(move || {
        worker.block_until_idle();
        let _ = done.send(());
    });
    assert!(
        finished
            .recv_timeout(std::time::Duration::from_secs(2))
            .is_ok(),
        "block_until_idle waited for `busy` although exit was already allowed"
    );
}
