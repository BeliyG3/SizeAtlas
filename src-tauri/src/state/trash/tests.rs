use std::fs;
use std::sync::atomic::AtomicBool;

use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};

use crate::error::CmdError;
use crate::state::{AppState, Trashed};

#[test]
fn the_trash_preview_counts_nested_items_once() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub").join("big.bin"), vec![0u8; 10_000]).unwrap();
    fs::write(dir.path().join("small.txt"), b"x").unwrap();
    let ScanOutcome::Done(tree) =
        scan(dir.path(), &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    let state = AppState::default();
    let sub = tree.children(0).find(|&c| tree.node(c).is_dir()).unwrap();
    let small = tree.children(0).find(|&c| !tree.node(c).is_dir()).unwrap();
    let big = tree.children(sub).next().unwrap();
    let size = tree.node(sub).size + tree.node(small).size;
    let generation = state.install_tree(tree);
    let preview = state
        .trash_preview(generation, 0, &[big, sub, small, sub])
        .unwrap();
    let canonical = dunce::canonicalize(dir.path()).unwrap();
    assert_eq!((preview.count, preview.size), (2, size));
    // By id: "small.txt" comes before "sub" in the tree.
    assert_eq!(
        preview.paths,
        [
            canonical.join("small.txt").display().to_string(),
            canonical.join("sub").display().to_string()
        ]
    );
    assert_eq!(
        state.trash_preview(generation, 1, &[sub]),
        Err(CmdError::StaleId),
        "another revision"
    );
    assert_eq!(
        state.trash_preview(generation, 0, &[0]),
        Err(CmdError::StaleId),
        "the root"
    );
    assert_eq!(
        state.trash_preview(generation, 0, &[]),
        Err(CmdError::StaleId)
    );
}

#[test]
fn a_folder_takes_its_new_time_only_if_it_had_the_known_one_before() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["a", "b", "c"] {
        fs::create_dir(dir.path().join(name)).unwrap();
        fs::write(dir.path().join(name).join("f.bin"), b"x").unwrap();
    }
    let ScanOutcome::Done(tree) =
        scan(dir.path(), &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    let state = AppState::default();
    let folder = |name: &str| tree.children(0).find(|&c| tree.name(c) == name).unwrap();
    let (a, b, c) = (folder("a"), folder("b"), folder("c"));
    let known = |id: u32| tree.node(id).mtime;
    let gone = |id: u32, before: i64, listed: Option<i64>| Trashed {
        id: tree.children(id).next().unwrap(),
        parent: id,
        parent_before: Some(before),
        parent_listed: listed,
        parent_after: Some(known(id) + 1_000),
    };
    let trashed = [
        gone(a, known(a), None),
        // Its own time had moved on, but its parent still listed the known one.
        gone(b, known(b) + 7, Some(known(b))),
        // Changed outside SizeAtlas: neither time is the known one.
        gone(c, known(c) + 7, Some(known(c) + 7)),
    ];
    let expected = [known(a) + 1_000, known(b) + 1_000, known(c)];
    let generation = state.install_tree(tree);
    let tree = state.remove_trashed(generation, &trashed, None).unwrap();
    assert_eq!([a, b, c].map(|id| tree.node(id).mtime), expected);
}
