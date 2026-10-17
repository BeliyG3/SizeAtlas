//! A trash request while a scan runs: a rescan is told what went, a refresh refuses its folder.

use std::sync::Mutex;

use super::fixture::{anywhere, deleting, id, open, real, rev};
use super::*;

#[test]
fn items_go_during_a_rescan_and_the_rescan_remembers_them() {
    let state = AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let top = id(&state, generation, &["top.bin"]);
    let root = state.summary(generation).unwrap().root;
    let rescan = state.enqueue(root).unwrap().unwrap();
    let done = run(
        &state,
        cache.path(),
        generation,
        0,
        &[top],
        anywhere,
        deleting(&log),
    )
    .unwrap();
    assert_eq!(done.removed, 1);
    let noted = rescan.trashed.lock().unwrap();
    assert_eq!(noted.len(), 1);
    assert_eq!(noted[0].path, real(&dir, &["top.bin"]));
    assert!(noted[0].parent_after.is_some());
}

#[test]
fn a_refresh_refuses_its_folder_and_a_selection_with_any_item_of_it() {
    let state = AppState::default();
    let (dir, generation) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let top = id(&state, generation, &["top.bin"]);
    let x = id(&state, generation, &["sub", "x.bin"]);
    let (root, folder) = state
        .refresh_target(generation, id(&state, generation, &["sub"]))
        .unwrap();
    let _refreshing = state.enqueue_folder(root, folder).unwrap().unwrap();
    let trash = |ids: &[u32]| {
        run(
            &state,
            cache.path(),
            generation,
            rev(&state, generation),
            ids,
            anywhere,
            deleting(&log),
        )
    };
    assert_eq!(
        state.trash_preview(generation, 0, &[x]),
        Err(CmdError::Busy)
    );
    assert_eq!(state.trash_refused(generation, 0, &[top, x]), Ok(true));
    assert_eq!(trash(&[top, x]), Err(CmdError::Busy));
    assert!(log.lock().unwrap().is_empty(), "nothing moved");
    assert_eq!(state.trash_refused(generation, 0, &[top]), Ok(false));
    assert_eq!(trash(&[top]).unwrap().removed, 1);
    assert!(real(&dir, &["sub", "x.bin"]).exists());
}
