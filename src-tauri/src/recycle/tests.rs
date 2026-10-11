use std::fs::{self, File};
use std::path::Path;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime};

use sizeatlas_core::tree::ListOrder;

use super::fixture::{anywhere, deleting, id, open, real, rev, settle};
use super::*;

#[test]
fn a_time_matches_as_the_item_has_it_or_as_its_folder_lists_it() {
    let never = || -> Option<i64> { panic!("the listing is read only when the own time differs") };
    assert!(unchanged(5, 5, never));
    assert!(
        unchanged(5, 7, || Some(5)),
        "the listing still has the old time"
    );
    assert!(!unchanged(5, 7, || Some(6)));
    assert!(!unchanged(5, 7, || None), "not in the listing");
}

#[test]
fn a_stale_request_moves_nothing() {
    let state = AppState::default();
    let (_dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let top = id(&state, generation, &["top.bin"]);
    let trash = |generation, rev, ids: &[u32]| {
        run(
            &state,
            cache.path(),
            generation,
            rev,
            ids,
            anywhere,
            deleting(&log),
        )
    };
    assert_eq!(
        trash(generation, 1, &[top]),
        Err(CmdError::StaleId),
        "another revision"
    );
    assert_eq!(
        trash(generation + 1, 0, &[top]),
        Err(CmdError::StaleId),
        "another tree"
    );
    assert_eq!(
        trash(generation, 0, &[0]),
        Err(CmdError::StaleId),
        "the root"
    );
    assert_eq!(trash(generation, 0, &[9_999]), Err(CmdError::StaleId));
    assert_eq!(trash(generation, 0, &[]), Err(CmdError::StaleId));
    assert!(log.lock().unwrap().is_empty());
}

#[test]
fn an_item_changed_on_disk_moves_nothing() {
    let state = AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let ids = [
        id(&state, generation, &["top.bin"]),
        id(&state, generation, &["sub", "x.bin"]),
    ];
    let x = real(&dir, &["sub", "x.bin"]);
    File::options()
        .write(true)
        .open(&x)
        .unwrap()
        .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000))
        .unwrap();
    settle(&x);
    let trash = || {
        run(
            &state,
            cache.path(),
            generation,
            0,
            &ids,
            anywhere,
            deleting(&log),
        )
    };
    assert_eq!(trash(), Err(CmdError::Changed));
    assert!(
        log.lock().unwrap().is_empty(),
        "checked before anything moves"
    );
    assert!(real(&dir, &["top.bin"]).exists());
    fs::remove_file(&x).unwrap();
    assert_eq!(
        trash(),
        Err(CmdError::Changed),
        "an item that is gone has changed too"
    );
}

#[test]
fn a_failed_item_is_reported_and_the_others_go() {
    let state = AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let ids = [
        id(&state, generation, &["top.bin"]),
        id(&state, generation, &["sub", "x.bin"]),
        id(&state, generation, &["sub", "y.bin"]),
    ];
    let deletes = deleting(&log);
    let picky = |path: &Path| {
        if path.ends_with("y.bin") {
            Err("in use".to_owned())
        } else {
            deletes(path)
        }
    };
    let done = run(&state, cache.path(), generation, 0, &ids, anywhere, picky).unwrap();
    let y = real(&dir, &["sub", "y.bin"]).display().to_string();
    let failed = TrashFailureDto {
        path: y.clone(),
        error: CmdError::Io {
            path: y,
            os_message: "in use".into(),
        },
    };
    assert_eq!(
        (done.removed, done.failed, done.warning),
        (2, vec![failed], None)
    );
    let summary = state.summary(generation).unwrap();
    assert_eq!(
        (summary.files, summary.rev),
        (1, 2),
        "one revision per removed item"
    );
    let sub = id(&state, generation, &["sub"]);
    let left = state
        .children(generation, sub, 0, 10, ListOrder::DEFAULT)
        .unwrap();
    assert_eq!(
        left.items
            .iter()
            .map(|i| i.name.as_str())
            .collect::<Vec<_>>(),
        ["y.bin"]
    );
    assert_eq!(
        sources::cached_scans(cache.path())[0].files,
        1,
        "saved after the change"
    );
}

#[test]
fn a_folder_can_go_after_one_of_its_items_went() {
    let state = AppState::default();
    let (_dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let x = id(&state, generation, &["sub", "x.bin"]);
    let sub = id(&state, generation, &["sub"]);
    thread::sleep(Duration::from_millis(50));
    run(
        &state,
        cache.path(),
        generation,
        0,
        &[x],
        anywhere,
        deleting(&log),
    )
    .unwrap();
    // Moving x.bin changed the time of sub on disk, and the tree took the new time.
    let again = run(
        &state,
        cache.path(),
        generation,
        rev(&state, generation),
        &[sub],
        anywhere,
        deleting(&log),
    );
    assert_eq!(again.map(|done| done.removed), Ok(1));
}

#[test]
fn a_folder_changed_outside_keeps_its_old_time() {
    let state = AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let x = id(&state, generation, &["sub", "x.bin"]);
    let sub = id(&state, generation, &["sub"]);
    // Someone else adds a file to sub after the scan; its listing has caught up (while it lags,
    // the change goes unseen: see `check`).
    thread::sleep(Duration::from_millis(50));
    fs::write(real(&dir, &["sub", "new.txt"]), b"n").unwrap();
    settle(&real(&dir, &["sub"]));
    run(
        &state,
        cache.path(),
        generation,
        0,
        &[x],
        anywhere,
        deleting(&log),
    )
    .unwrap();
    let again = run(
        &state,
        cache.path(),
        generation,
        rev(&state, generation),
        &[sub],
        anywhere,
        deleting(&log),
    );
    assert_eq!(again, Err(CmdError::Changed));
    assert!(real(&dir, &["sub"]).exists());
}

#[test]
fn an_item_inside_another_one_goes_with_it() {
    let state = AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let sub = id(&state, generation, &["sub"]);
    let x = id(&state, generation, &["sub", "x.bin"]);
    let done = run(
        &state,
        cache.path(),
        generation,
        0,
        &[x, sub, sub],
        anywhere,
        deleting(&log),
    )
    .unwrap();
    assert_eq!((done.removed, done.failed.len()), (1, 0));
    assert_eq!(*log.lock().unwrap(), [real(&dir, &["sub"])]);
    // 3 dead nodes of 5: the tree was compacted under a new generation.
    assert_eq!(state.summary(generation), Err(CmdError::StaleId));
    assert_eq!(state.summaries()[0].files, 1);
}

#[test]
fn a_root_with_a_running_scan_is_busy() {
    let state = AppState::default();
    let (_dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let top = id(&state, generation, &["top.bin"]);
    let root = state.summary(generation).unwrap().root;
    let _scanning = state.enqueue(root).unwrap();
    let done = run(
        &state,
        cache.path(),
        generation,
        0,
        &[top],
        anywhere,
        deleting(&log),
    );
    assert_eq!(done, Err(CmdError::Busy));
    assert!(log.lock().unwrap().is_empty());
}

#[test]
fn an_unsaved_change_comes_back_as_a_warning() {
    let state = AppState::default();
    let (_dir, generation) = open(&state);
    let log = Mutex::new(Vec::new());
    let not_a_dir = tempfile::NamedTempFile::new().unwrap();
    let top = id(&state, generation, &["top.bin"]);
    let done = run(
        &state,
        not_a_dir.path(),
        generation,
        0,
        &[top],
        anywhere,
        deleting(&log),
    )
    .unwrap();
    assert_eq!(
        (done.removed, done.warning),
        (1, Some(CmdError::CacheNotSaved))
    );
    assert_eq!(state.summary(generation).unwrap().files, 2);
}

/// The real trash of the OS; run by hand on each system:
/// `cargo test -p sizeatlas --locked -- --ignored real_trash`. Leaves one small file in the trash.
#[test]
#[ignore = "puts a file in the real trash"]
fn real_trash_takes_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("sizeatlas-trash-test.txt");
    fs::write(&file, b"SizeAtlas test").unwrap();
    move_to_trash(&file).unwrap();
    assert!(!file.exists());
}
