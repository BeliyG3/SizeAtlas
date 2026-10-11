use std::fs;
use std::path::MAIN_SEPARATOR_STR as SEP;
use std::sync::atomic::AtomicBool;

use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};
use sizeatlas_core::tree::ListKind;

use crate::error::CmdError;
use crate::state::AppState;

#[test]
fn lists_give_each_item_its_folder_below_the_listed_one() {
    let dir = tempfile::tempdir().unwrap();
    let deep = dir.path().join("a").join("b");
    fs::create_dir_all(&deep).unwrap();
    fs::write(deep.join("big.bin"), vec![0u8; 20_000]).unwrap();
    fs::write(dir.path().join("a").join("small.txt"), b"x").unwrap();
    fs::write(dir.path().join("empty.txt"), b"").unwrap();
    let ScanOutcome::Done(tree) =
        scan(dir.path(), &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    let state = AppState::default();
    let generation = state.install_tree(tree);
    let rows = |id, kind| -> Vec<(String, String)> {
        let list = state.list(generation, id, kind, 10).unwrap();
        list.items
            .into_iter()
            .map(|i| (i.item.name, i.folder))
            .collect()
    };
    let pair = |name: &str, folder: &str| (name.to_owned(), folder.to_owned());

    assert_eq!(
        rows(0, ListKind::LargestFiles),
        [
            pair("big.bin", &format!("a{SEP}b")),
            pair("small.txt", "a"),
            pair("empty.txt", ""),
        ]
    );
    let folders = state
        .list(generation, 0, ListKind::LargestFolders, 10)
        .unwrap();
    let names: Vec<&str> = folders.items.iter().map(|i| i.item.name.as_str()).collect();
    assert_eq!(names, ["a", "b"]);
    let (a, b) = (folders.items[0].item.id, folders.items[1].item.id);
    assert_eq!(folders.items[1].parent, a);
    assert_eq!(folders.size, state.summary(generation).unwrap().total);
    assert!(!folders.truncated);

    let files = state
        .list(generation, 0, ListKind::LargestFiles, 1)
        .unwrap();
    assert_eq!(files.items[0].parent, b, "the file's own folder");
    assert!(files.truncated, "three files matched, one was asked for");
    assert_eq!(
        rows(a, ListKind::LargestFiles),
        [pair("big.bin", "b"), pair("small.txt", "")]
    );
    assert_eq!(rows(0, ListKind::EmptyFiles), [pair("empty.txt", "")]);
    let all = state
        .list(generation, 0, ListKind::Largest, u32::MAX)
        .unwrap();
    assert_eq!(all.items.len(), 5);
    assert_eq!(
        state.list(generation + 1, 0, ListKind::Largest, 10),
        Err(CmdError::StaleId)
    );
    assert_eq!(
        state.list(generation, 9_999, ListKind::Largest, 10),
        Err(CmdError::StaleId)
    );
}

#[test]
fn list_items_are_lossy_when_any_folder_of_their_path_is() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("a")).unwrap();
    fs::write(dir.path().join("a").join("f.txt"), b"x").unwrap();
    fs::write(dir.path().join("g.txt"), b"x").unwrap();
    let ScanOutcome::Done(mut tree) =
        scan(dir.path(), &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    let a = tree.children(0).find(|&c| tree.node(c).is_dir()).unwrap();
    tree.mark_lossy_for_test(a);
    let state = AppState::default();
    let generation = state.install_tree(tree);
    let list = state
        .list(generation, 0, ListKind::LargestFiles, 10)
        .unwrap();
    let mut lossy: Vec<(&str, bool)> = list
        .items
        .iter()
        .map(|i| (i.item.name.as_str(), i.item.lossy))
        .collect();
    lossy.sort(); // equal sizes: the order is by id
    assert_eq!(lossy, [("f.txt", true), ("g.txt", false)]);
}
