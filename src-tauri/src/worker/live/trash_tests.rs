//! Moving items to the trash while a scan runs: what a first scan has finished may go, what it
//! has not stays; an item a rescan listed before it went is not in the installed tree.

use std::fs;
use std::path::PathBuf;

use sizeatlas_core::cache::{self, cache_path};
use sizeatlas_core::tree::{ListOrder, flags};

use super::tests::assert_totals;
use super::*;
use crate::recycle::fixture::{anywhere, deleting, settle};
use crate::worker::tests::{root_of, run_queue};

/// `names` below `root`, created as files (with a slash: inside folders), settled.
fn files(root: &Path, names: &[&str]) {
    for name in names {
        let path = root.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, name.as_bytes()).unwrap();
    }
    for name in names {
        settle(&root.join(name));
        settle(root.join(name).parent().unwrap());
    }
}

fn saved(cache: &Path, root: &str) -> Tree {
    cache::load(&cache_path(cache, Path::new(root))).unwrap().1
}

#[test]
fn a_first_scan_lets_finished_folders_and_root_files_go_but_not_pending_ones() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    files(dir.path(), &["top.txt", "a/f.txt", "a/g.txt", "b/h.txt"]);
    let state = AppState::default();
    // A complete saved scan, then a first scan again (the root was closed): a trash meanwhile
    // must not replace the saved scan with the partial tree.
    run_queue(&state, cache.path(), state.enqueue(root_of(&dir)).unwrap());
    jobs::close_root(&state, &root_of(&dir));
    let file = cache_path(cache.path(), Path::new(&root_of(&dir)));
    let complete = fs::read(&file).unwrap();
    let job = state.enqueue(root_of(&dir)).unwrap().unwrap();
    let root = PathBuf::from(&job.root);
    let notify: Notify = Arc::new(|_| {});
    let log = Mutex::new(Vec::new());
    let mut session = Session::new();
    let mut checked = false;
    scanner::scan_live(dir.path(), &job.cancel, &job.progress, |event| {
        let done = match &event {
            LiveEvent::FolderDone { id, .. } => Some(*id),
            _ => None,
        };
        session.publish(&state, &job, event, &notify);
        let scan = session.scan.unwrap();
        let tree = state.tree(scan).unwrap();
        if done.is_none_or(|id| tree.name(id) != "a") {
            return;
        }
        let find = |name: &str| tree.find_path(&root.join(name)).unwrap();
        let (top, f, b) = (find("top.txt"), find("a/f.txt"), find("b"));
        let rev = tree.rev;
        drop(tree);
        assert_eq!(state.trash_refused(scan, rev, &[b]), Ok(true), "pending");
        let trash = |ids: &[u32]| {
            crate::recycle::run(
                &state,
                cache.path(),
                scan,
                rev,
                ids,
                anywhere,
                deleting(&log),
            )
        };
        assert_eq!(trash(&[top, f, b]), Err(CmdError::Busy));
        assert!(log.lock().unwrap().is_empty(), "nothing moved");
        let done = trash(&[top, f]).unwrap();
        assert_eq!((done.removed, done.warning), (2, None));
        assert_eq!(
            fs::read(&file).unwrap(),
            complete,
            "the saved scan is untouched"
        );
        let tree = state.tree(scan).expect("same generation: ids stay");
        assert_eq!((tree.name(b), tree.node(0).files), ("b", 1));
        assert_totals(&tree);
        checked = true;
    })
    .unwrap();
    assert!(checked);
    let scan = session.scan.unwrap();
    let write = tauri::async_runtime::block_on(state.begin_write()).unwrap();
    finish(&state, cache.path(), &job, scan, write, &notify).unwrap();
    let tree = state.tree(scan).unwrap();
    assert_totals(&tree);
    assert_eq!(
        tree.node(0).files,
        2,
        "g.txt and h.txt; b was grafted after the trash"
    );
    assert!(tree.find_path(&root.join("b/h.txt")).is_some());
    // What the contents table asks for once the scan is over: the summary, then the folder.
    let summary = state.summaries()[0].clone();
    assert_eq!((summary.generation, summary.rev), (scan, tree.rev));
    assert!(!summary.scanning);
    let a = tree.find_path(&root.join("a")).unwrap();
    drop(tree);
    let page = state
        .children(summary.generation, a, 0, 200, ListOrder::DEFAULT)
        .unwrap();
    assert_eq!((page.rev, page.total), (summary.rev, 1));
    let names: Vec<_> = page.items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(names, ["g.txt"]);
    let saved = saved(cache.path(), &job.root);
    assert_eq!(saved.node(0).files, 2);
    assert!(saved.find_path(&root.join("a/f.txt")).is_none());
    assert!(saved.find_path(&root.join("top.txt")).is_none());
}

#[test]
fn an_item_a_rescan_listed_before_it_went_is_not_in_the_installed_tree() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    files(dir.path(), &["top.txt", "sub/x.txt", "sub/y.txt"]);
    let state = AppState::default();
    run_queue(&state, cache.path(), state.enqueue(root_of(&dir)).unwrap());
    let old = state.summaries()[0].clone();
    let root = PathBuf::from(&old.root);
    let x = root.join("sub/x.txt");
    let job = state.enqueue(old.root.clone()).unwrap().unwrap();
    // The walk lists x.txt; then it goes to the trash from the tree shown.
    let walked = jobs::walk(&job).unwrap().unwrap();
    assert!(walked.find_path(&x).is_some());
    let id = state.tree(old.generation).unwrap().find_path(&x).unwrap();
    let log = Mutex::new(Vec::new());
    let done = crate::recycle::run(
        &state,
        cache.path(),
        old.generation,
        old.rev,
        &[id],
        anywhere,
        deleting(&log),
    )
    .unwrap();
    assert_eq!(done.removed, 1);
    let write = tauri::async_runtime::block_on(state.begin_write()).unwrap();
    let notify: Notify = Arc::new(|_| {});
    install_and_save(&state, cache.path(), &job, walked, write, &notify).unwrap();
    let summary = state.summaries()[0].clone();
    assert_ne!(summary.generation, old.generation);
    let tree = state.tree(summary.generation).unwrap();
    assert!(tree.find_path(&x).is_none());
    assert!(tree.find_path(&root.join("sub/y.txt")).is_some());
    assert_eq!(tree.node(0).files, 2);
    assert_totals(&tree);
    let saved = saved(cache.path(), &old.root);
    assert!(saved.find_path(&x).is_none());
    assert_eq!(saved.node(0).files, 2);
    // Its folder has the time it got from the trash, so the folder can go too.
    let sub = tree.find_path(&root.join("sub")).unwrap();
    let now = state.summaries()[0].rev;
    drop(tree);
    let done = crate::recycle::run(
        &state,
        cache.path(),
        summary.generation,
        now,
        &[sub],
        anywhere,
        deleting(&log),
    )
    .unwrap();
    assert_eq!((done.removed, done.failed), (1, Vec::new()));
}

/// The whole worker, as the app runs it: a trash of a finished folder's file during a first
/// scan (holding the write, as the command does) is gone from the tree the scan installs.
#[test]
fn a_file_trashed_during_a_first_scan_stays_out_of_the_finished_tree() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    files(dir.path(), &["a/f.txt", "a/g.txt", "b/h.txt"]);
    // Enough in b that the walk is still busy when the trash takes the write.
    for i in 0..2000 {
        fs::write(dir.path().join(format!("b/{i}")), b"x").unwrap();
    }
    let state = AppState::default();
    let job = state.enqueue(root_of(&dir)).unwrap();
    let root = PathBuf::from(&root_of(&dir));
    let log = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        let trasher = s.spawn(|| {
            let wait = |done: &dyn Fn() -> bool| {
                let start = Instant::now();
                while !done() {
                    assert!(
                        start.elapsed() < Duration::from_secs(10),
                        "scan never got there"
                    );
                    std::thread::sleep(Duration::from_millis(1));
                }
            };
            wait(&|| !state.summaries().is_empty());
            // Before the walk ends: the scan cannot finish until this write is released.
            let write = tauri::async_runtime::block_on(state.begin_write()).unwrap();
            let summary = state.summaries()[0].clone();
            let a_done = || {
                let tree = state.tree(summary.generation).unwrap();
                tree.find_path(&root.join("a/f.txt")).is_some()
            };
            wait(&a_done);
            let tree = state.tree(summary.generation).unwrap();
            assert!(tree.node(0).has(flags::SCANNING));
            let f = tree.find_path(&root.join("a/f.txt")).unwrap();
            drop(tree);
            let done = crate::recycle::run(
                &state,
                cache.path(),
                summary.generation,
                summary.rev,
                &[f],
                anywhere,
                deleting(&log),
            )
            .unwrap();
            assert_eq!((done.removed, done.warning), (1, None));
            drop(write);
        });
        run_queue(&state, cache.path(), job);
        trasher.join().unwrap();
    });
    let summary = state.summaries()[0].clone();
    assert!(!summary.scanning);
    let tree = state.tree(summary.generation).unwrap();
    assert!(tree.find_path(&root.join("a/f.txt")).is_none());
    let a = tree.find_path(&root.join("a")).unwrap();
    drop(tree);
    let page = state
        .children(summary.generation, a, 0, 200, ListOrder::DEFAULT)
        .unwrap();
    let names: Vec<_> = page.items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!((page.rev, names), (summary.rev, vec!["g.txt"]));
    assert!(
        saved(cache.path(), &summary.root)
            .find_path(&root.join("a/f.txt"))
            .is_none()
    );
}
