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
        let list = state.list(generation, id, kind, 10, None).unwrap();
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
        .list(generation, 0, ListKind::LargestFolders, 10, None)
        .unwrap();
    let names: Vec<&str> = folders.items.iter().map(|i| i.item.name.as_str()).collect();
    assert_eq!(names, ["a", "b"]);
    let (a, b) = (folders.items[0].item.id, folders.items[1].item.id);
    assert_eq!(folders.items[1].parent, a);
    assert_eq!(folders.size, state.summary(generation).unwrap().total);
    assert!(!folders.truncated);

    let files = state
        .list(generation, 0, ListKind::LargestFiles, 1, None)
        .unwrap();
    assert_eq!(files.items[0].parent, b, "the file's own folder");
    assert!(files.truncated, "three files matched, one was asked for");
    assert_eq!(
        rows(a, ListKind::LargestFiles),
        [pair("big.bin", "b"), pair("small.txt", "")]
    );
    assert_eq!(rows(0, ListKind::EmptyFiles), [pair("empty.txt", "")]);
    let all = state
        .list(generation, 0, ListKind::Largest, u32::MAX, None)
        .unwrap();
    assert_eq!(all.items.len(), 5);
    assert_eq!(
        state.list(generation + 1, 0, ListKind::Largest, 10, None),
        Err(CmdError::StaleId)
    );
    assert_eq!(
        state.list(generation, 9_999, ListKind::Largest, 10, None),
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
        .list(generation, 0, ListKind::LargestFiles, 10, None)
        .unwrap();
    let mut lossy: Vec<(&str, bool)> = list
        .items
        .iter()
        .map(|i| (i.item.name.as_str(), i.item.lossy))
        .collect();
    lossy.sort(); // equal sizes: the order is by id
    assert_eq!(lossy, [("f.txt", true), ("g.txt", false)]);
}

/// `backup/backup.zip` (4000 bytes), `backup/notes.txt`, `Backup.txt` and `other.bin`.
fn searchable() -> (AppState, u64) {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("backup")).unwrap();
    fs::write(
        dir.path().join("backup").join("backup.zip"),
        vec![0u8; 4_000],
    )
    .unwrap();
    fs::write(dir.path().join("backup").join("notes.txt"), b"x").unwrap();
    fs::write(dir.path().join("Backup.txt"), b"x").unwrap();
    fs::write(dir.path().join("other.bin"), b"x").unwrap();
    let ScanOutcome::Done(tree) =
        scan(dir.path(), &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    let state = AppState::default();
    let generation = state.install_tree(tree);
    (state, generation)
}

#[test]
fn search_lists_matches_with_their_totals() {
    let (state, generation) = searchable();
    let list = state
        .list(generation, 0, ListKind::Search, 10, Some("BACKUP"))
        .unwrap();
    let rows: Vec<(&str, &str)> = list
        .items
        .iter()
        .map(|i| (i.item.name.as_str(), i.folder.as_str()))
        .collect();
    assert_eq!(rows.len(), 3, "folder, zip, Backup.txt: {rows:?}");
    assert!(rows.contains(&("backup", "")) && rows.contains(&("backup.zip", "backup")));
    assert!(rows.contains(&("Backup.txt", "")));
    let found = list.found.expect("search reports its totals");
    assert_eq!(found.count, 3);
    // The zip inside the matching folder is sized once, with the folder.
    let size_of = |name: &str| {
        list.items
            .iter()
            .find(|i| i.item.name == name)
            .unwrap()
            .item
            .size
    };
    assert_eq!(found.size, size_of("backup") + size_of("Backup.txt"));
    assert!(!list.truncated);

    let limited = state
        .list(generation, 0, ListKind::Search, 1, Some("backup"))
        .unwrap();
    assert_eq!(limited.items.len(), 1);
    assert!(limited.truncated);
    assert_eq!(limited.found.unwrap().count, 3, "totals ignore the limit");
}

#[test]
fn search_takes_conditions_alone_or_with_a_name() {
    let (state, generation) = searchable();
    let names = |query: &str| -> Vec<String> {
        let list = state
            .list(generation, 0, ListKind::Search, 10, Some(query))
            .unwrap();
        list.items.into_iter().map(|i| i.item.name).collect()
    };
    assert_eq!(names("type:archive"), ["backup.zip"]);
    assert_eq!(names("folders"), ["backup"]);
    // Just written files are neither old nor of unknown date; the app's "now" is real.
    assert_eq!(names("files newer:1d backup type:archive"), ["backup.zip"]);
    assert!(names("older:1d").is_empty());
}

#[test]
fn search_without_words_finds_nothing() {
    let (state, generation) = searchable();
    for query in [None, Some(""), Some("   ")] {
        let list = state
            .list(generation, 0, ListKind::Search, 10, query)
            .unwrap();
        assert!(list.items.is_empty() && !list.truncated, "{query:?}");
        assert_eq!(
            list.found.map(|f| (f.count, f.size)),
            Some((0, 0)),
            "{query:?}"
        );
    }
}

#[test]
fn other_lists_ignore_the_query_and_report_no_totals() {
    let (state, generation) = searchable();
    let plain = state
        .list(generation, 0, ListKind::LargestFiles, 10, None)
        .unwrap();
    let asked = state
        .list(generation, 0, ListKind::LargestFiles, 10, Some("other"))
        .unwrap();
    assert_eq!(plain, asked);
    assert_eq!(asked.items.len(), 4);
    assert_eq!(asked.found, None);
}

#[test]
fn a_huge_or_odd_query_is_cut_and_harmless() {
    let (state, generation) = searchable();
    let started = std::time::Instant::now();
    let huge = "a*".repeat(5_000);
    let list = state
        .list(generation, 0, ListKind::Search, 10, Some(&huge))
        .unwrap();
    assert!(list.found.is_some());
    assert!(started.elapsed().as_secs() < 5, "{:?}", started.elapsed());

    // Only the first 256 characters count, by character: the rest may be anything.
    let long_tail = format!("backup{}{}", " ".repeat(300), "zzz");
    let list = state
        .list(generation, 0, ListKind::Search, 10, Some(&long_tail))
        .unwrap();
    assert_eq!(list.found.unwrap().count, 3, "the tail word was dropped");
    let wide = "я".repeat(300);
    state
        .list(generation, 0, ListKind::Search, 10, Some(&wide))
        .unwrap();

    let list = state
        .list(
            generation,
            0,
            ListKind::Search,
            10,
            Some(
                "{0}	
",
            ),
        )
        .unwrap();
    assert!(list.items.is_empty());
    assert_eq!(list.found.map(|f| f.count), Some(0));
}
