//! Requests that run after the tree they were planned on changed: a rescan, an earlier request.
//! Items are found by path then; what an earlier request took is gone already, not an error.

use std::fs::{self, File};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, SystemTime};

use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};

use super::fixture::{anywhere, deleting, id, open, real, rev, settle};
use super::run_plan;
use crate::dto::TrashProgressDto;
use crate::error::CmdError;
use crate::sources;
use crate::state::{AppState, TrashPlan};

/// The plan of `items` on the tree with `generation`.
fn plan(state: &AppState, generation: u64, items: &[&[&str]]) -> TrashPlan {
    let ids: Vec<u32> = items.iter().map(|p| id(state, generation, p)).collect();
    state
        .trash_plan(generation, rev(state, generation), &ids)
        .unwrap()
}

/// sub/a.bin added on disk, then the root scanned again; returns the new generation.
fn rescan_with_a_new_file(state: &AppState, dir: &Path) -> u64 {
    let added = dir.join("sub").join("a.bin");
    fs::write(&added, b"a").unwrap();
    settle(&added);
    settle(&dir.join("sub"));
    let ScanOutcome::Done(tree) = scan(dir, &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    state.install_tree(tree)
}

#[test]
fn a_request_planned_before_a_rescan_goes_by_its_paths() {
    let state = AppState::default();
    let (dir, g) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let plan = plan(&state, g, &[&["sub", "x.bin"], &["top.bin"]]);
    let g2 = rescan_with_a_new_file(&state, dir.path());
    let done = run_plan(
        &state,
        cache.path(),
        g,
        plan,
        anywhere,
        deleting(&log),
        &|| false,
        |_| (),
    )
    .unwrap();
    assert_eq!(done.removed, 2);
    let (x, top) = (real(&dir, &["sub", "x.bin"]), real(&dir, &["top.bin"]));
    // The full paths of the plan, in its order (by id: top.bin comes first).
    assert_eq!(*log.lock().unwrap(), [top.clone(), x.clone()]);
    let tree = state.tree(g2).unwrap();
    assert_eq!(tree.find_path(&x), None);
    assert_eq!(tree.find_path(&top), None);
    assert!(tree.find_path(&real(&dir, &["sub", "a.bin"])).is_some());
    assert_eq!(state.summaries()[0].files, 2);
    assert_eq!(sources::cached_scans(cache.path())[0].files, 2);
}

#[test]
fn a_file_changed_before_its_queued_request_runs_stays() {
    let state = AppState::default();
    let (dir, g) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let plan = plan(&state, g, &[&["sub", "x.bin"], &["top.bin"]]);
    rescan_with_a_new_file(&state, dir.path());
    let top = real(&dir, &["top.bin"]);
    File::options()
        .write(true)
        .open(&top)
        .unwrap()
        .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000))
        .unwrap();
    settle(&top);
    let refused = run_plan(
        &state,
        cache.path(),
        g,
        plan,
        anywhere,
        deleting(&log),
        &|| false,
        |_| (),
    );
    assert_eq!(refused, Err(CmdError::Changed));
    assert!(log.lock().unwrap().is_empty());
    assert!(real(&dir, &["sub", "x.bin"]).exists() && top.exists());
}

#[test]
fn an_item_whose_folder_went_in_an_earlier_request_is_already_gone() {
    let state = AppState::default();
    let (dir, g) = open(&state);
    let (cache, log) = (tempfile::tempdir().unwrap(), Mutex::new(Vec::new()));
    let (p1, p2) = (
        plan(&state, g, &[&["sub"]]),
        plan(&state, g, &[&["sub", "x.bin"]]),
    );
    let run = |plan, report: &mut dyn FnMut(TrashProgressDto)| {
        let (dir, trash_one) = (cache.path(), deleting(&log));
        run_plan(&state, dir, g, plan, anywhere, trash_one, &|| false, report).unwrap()
    };
    assert_eq!(run(p1, &mut |_| ()).removed, 1);
    let mut last = None;
    let done = run(p2, &mut |progress| last = Some(progress));
    assert_eq!(
        (done.removed, done.gone, done.failed.len(), done.warning),
        (0, 1, 0, None)
    );
    assert_eq!(*log.lock().unwrap(), [real(&dir, &["sub"])]);
    let last = last.expect("a progress at the end");
    assert_eq!((last.done, last.total), (1, 1));
}
