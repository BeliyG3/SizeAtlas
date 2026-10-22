//! A trash request while other things happen: the window closes, the tree changes, an item
//! changes or cannot go, the root closes.

use std::fs::{self, File};
use std::path::Path;
use std::sync::{Mutex, mpsc};
use std::thread;
use std::time::{Duration, SystemTime};

use sizeatlas_core::cache::{self, cache_path};
use sizeatlas_core::scanner::mtime_of;
use sizeatlas_core::tree::{DirRec, FileRec, NO_PARENT, flags};

use super::fixture::{anywhere, deleting, id, open, real, rev, settle};
use super::run;
use crate::error::CmdError;
use crate::exit::ExitDecision;
use crate::jobs;

#[test]
fn closing_the_window_waits_for_the_moving_item_and_the_saved_scan() {
    let state = crate::state::AppState::default();
    let (_dir, generation) = open(&state);
    let cache = tempfile::tempdir().unwrap();
    let ids = [
        id(&state, generation, &["top.bin"]),
        id(&state, generation, &["sub", "x.bin"]),
    ];
    let root = state.summary(generation).unwrap().root;
    let (worker, dir) = (state.clone(), cache.path().to_path_buf());
    let trashing = thread::spawn(move || {
        // As the `trash` command does: the whole request holds `busy`.
        let write = tauri::async_runtime::block_on(worker.begin_write()).unwrap();
        let log = Mutex::new(Vec::new());
        let deletes = deleting(&log);
        let slow = |path: &Path| {
            thread::sleep(Duration::from_millis(300));
            deletes(path)
        };
        let done = run(&worker, &dir, generation, 0, &ids, anywhere, slow);
        drop(write);
        done
    });
    thread::sleep(Duration::from_millis(100));
    assert_eq!(
        state.on_exit_request(),
        ExitDecision::PreventAndWait,
        "a trash runs"
    );
    tauri::async_runtime::block_on(state.wait_until_idle());
    let done = trashing.join().unwrap().unwrap();
    assert_eq!(done.removed, 1, "the moving item went, the next one stays");
    let (_, saved) = cache::load(&cache_path(cache.path(), Path::new(&root))).unwrap();
    assert_eq!(
        saved.node(0).files,
        2,
        "the saved scan no longer lists the moved item"
    );
}

#[test]
fn a_row_of_a_folder_refreshed_since_is_stale() {
    let state = crate::state::AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let sub = id(&state, generation, &["sub"]);
    let x = id(&state, generation, &["sub", "x.bin"]);
    // The folder is refreshed: its items get new ids, the old ones die and stay dead.
    let records = vec![DirRec {
        id: 0,
        parent: NO_PARENT,
        name: "sub".into(),
        mtime: 1,
        flags: flags::IS_DIR,
        files: Vec::new(),
    }];
    state
        .change_tree(generation, |tree| {
            tree.replace_subtree(sub, records);
            Some(())
        })
        .unwrap();
    let now = rev(&state, generation);
    let trash = run(
        &state,
        cache.path(),
        generation,
        now,
        &[x],
        anywhere,
        deleting(&log),
    );
    assert_eq!(
        trash,
        Err(CmdError::StaleId),
        "an old row of the current revision"
    );
    assert!(log.lock().unwrap().is_empty());
    assert!(real(&dir, &["sub", "x.bin"]).exists());
}

#[test]
fn an_item_without_room_in_the_trash_stays_and_the_others_go() {
    let state = crate::state::AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let ids = [
        id(&state, generation, &["top.bin"]),
        id(&state, generation, &["sub", "x.bin"]),
    ];
    let no_bin_for_x = |path: &Path, _: u64| !path.ends_with("x.bin");
    let done = run(
        &state,
        cache.path(),
        generation,
        0,
        &ids,
        no_bin_for_x,
        deleting(&log),
    )
    .unwrap();
    assert_eq!(done.removed, 1);
    assert_eq!(done.failed.len(), 1);
    assert_eq!(done.failed[0].error, CmdError::NoTrash);
    assert!(
        real(&dir, &["sub", "x.bin"]).exists(),
        "never deleted for good"
    );
}

#[test]
fn an_item_changed_while_the_others_moved_stays() {
    let state = crate::state::AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let ids = [
        id(&state, generation, &["top.bin"]),
        id(&state, generation, &["sub", "x.bin"]),
    ];
    let x = real(&dir, &["sub", "x.bin"]);
    let deletes = deleting(&log);
    // While top.bin moves, someone changes x.bin.
    let meanwhile = |path: &Path| {
        let done = deletes(path);
        File::options()
            .write(true)
            .open(&x)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000))
            .unwrap();
        settle(&x);
        done
    };
    let done = run(
        &state,
        cache.path(),
        generation,
        0,
        &ids,
        anywhere,
        meanwhile,
    )
    .unwrap();
    assert_eq!(done.removed, 1);
    assert_eq!(done.failed[0].error, CmdError::Changed);
    assert!(x.exists());
}

#[test]
fn a_root_closed_during_the_trash_loses_its_saved_scan() {
    let state = crate::state::AppState::default();
    let (_dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let root = state.summary(generation).unwrap().root;
    jobs::save(&state.tree(generation).unwrap(), cache.path()).unwrap();
    let file = cache_path(cache.path(), Path::new(&root));
    assert!(file.exists());
    let top = id(&state, generation, &["top.bin"]);
    let deletes = deleting(&log);
    let closing = |path: &Path| {
        let done = deletes(path);
        state.close_path(&root);
        done
    };
    let done = run(
        &state,
        cache.path(),
        generation,
        0,
        &[top],
        anywhere,
        closing,
    )
    .unwrap();
    assert_eq!(
        (done.removed, done.warning),
        (1, Some(CmdError::CacheNotSaved))
    );
    assert!(!file.exists(), "it still listed the moved item");
}

#[test]
fn the_trash_limit_takes_the_length_of_an_item_small_on_disk() {
    let state = crate::state::AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let sub = id(&state, generation, &["sub"]);
    let x = real(&dir, &["sub", "x.bin"]);
    let mtime = |path: &Path| mtime_of(&fs::symlink_metadata(path).unwrap());
    // x.bin as a cloud placeholder: nothing on disk, 50 GiB long.
    let records = vec![DirRec {
        id: 0,
        parent: NO_PARENT,
        name: "sub".into(),
        mtime: mtime(&real(&dir, &["sub"])),
        flags: flags::IS_DIR,
        files: vec![FileRec {
            name: "x.bin".into(),
            size: 0,
            len: 50 << 30,
            mtime: mtime(&x),
            flags: 0,
            ino: None,
        }],
    }];
    state
        .change_tree(generation, |tree| {
            tree.replace_subtree(sub, records);
            Some(())
        })
        .unwrap();
    let placeholder = id(&state, generation, &["sub", "x.bin"]);
    let asked = Mutex::new(Vec::new());
    let bin_of_10_gib = |_: &Path, size: u64| {
        asked.lock().unwrap().push(size);
        size <= 10 << 30
    };
    let now = rev(&state, generation);
    let done = run(
        &state,
        cache.path(),
        generation,
        now,
        &[placeholder],
        bin_of_10_gib,
        deleting(&log),
    )
    .unwrap();
    assert_eq!(*asked.lock().unwrap(), [50 << 30]);
    assert_eq!(done.failed[0].error, CmdError::NoTrash);
    assert!(x.exists(), "never deleted for good");
}

#[test]
fn a_root_opened_again_during_the_trash_waits_for_it_and_keeps_its_saved_scan() {
    let state = crate::state::AppState::default();
    let (_dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let root = state.summary(generation).unwrap().root;
    jobs::save(&state.tree(generation).unwrap(), cache.path()).unwrap();
    let file = cache_path(cache.path(), Path::new(&root));
    let top = id(&state, generation, &["top.bin"]);
    // As the `trash` command does: the whole request holds `busy`.
    let write = tauri::async_runtime::block_on(state.begin_write()).unwrap();
    let (opened, opening) = mpsc::channel();
    let deletes = deleting(&log);
    let reopening = |path: &Path| {
        let done = deletes(path);
        let (state, dir, root) = (state.clone(), cache.path().to_owned(), root.clone());
        let opened = opened.clone();
        thread::spawn(move || {
            let summary = jobs::open_cached_waiting(state, dir, root);
            opened
                .send(tauri::async_runtime::block_on(summary))
                .unwrap();
        });
        // An open that does not wait for `busy` ends meanwhile.
        thread::sleep(Duration::from_millis(500));
        done
    };
    let done = run(
        &state,
        cache.path(),
        generation,
        0,
        &[top],
        anywhere,
        reopening,
    )
    .unwrap();
    drop(write);
    let summary = opening.recv().unwrap().unwrap();
    assert_eq!((done.removed, done.warning), (1, None));
    let (_, saved) = cache::load(&file).expect("the saved scan stays");
    assert_eq!(saved.node(0).files, 2, "without the moved item");
    assert_eq!(state.summary(summary.generation).unwrap().files, 2);
}
