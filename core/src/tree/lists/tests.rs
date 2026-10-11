use super::*;
use crate::tree::{DirRec, FileRec, NO_PARENT, ScanMeta, SizeMode, flags, sample_tree};

const META: ScanMeta = ScanMeta {
    cluster: 0,
    size_mode: SizeMode::Logical,
    scanned_at: 0,
};

fn file(name: &str, size: u64, mtime: i64) -> FileRec {
    FileRec {
        name: name.into(),
        size,
        len: size,
        mtime,
        flags: 0,
        ino: None,
    }
}

fn dir(id: u32, parent: u32, name: &str, mtime: i64, files: Vec<FileRec>) -> DirRec {
    DirRec {
        id,
        parent,
        name: name.into(),
        mtime,
        flags: 0,
        files,
    }
}

/// ```text
/// /r              a.bin 100 (t30), z.txt 0 (time unknown)
///   docs (t15)    b.pdf 300 (t20), old.txt 5 (t5)
///     deep (t35)  c.dat 50 (t40)
///       void (t45)
///   empty (t25)
/// ```
fn tree() -> Tree {
    Tree::from_records(
        vec![
            dir(
                0,
                NO_PARENT,
                "/r",
                1,
                vec![file("a.bin", 100, 30), file("z.txt", 0, 0)],
            ),
            dir(
                1,
                0,
                "docs",
                15,
                vec![file("b.pdf", 300, 20), file("old.txt", 5, 5)],
            ),
            dir(2, 0, "empty", 25, vec![]),
            dir(3, 1, "deep", 35, vec![file("c.dat", 50, 40)]),
            dir(4, 3, "void", 45, vec![]),
        ],
        META,
    )
}

fn id_of(tree: &Tree, name: &str) -> u32 {
    (0..tree.len() as u32)
        .find(|&id| tree.name(id) == name)
        .unwrap()
}

fn names(tree: &Tree, ids: Vec<u32>) -> Vec<&str> {
    ids.into_iter().map(|id| tree.name(id)).collect()
}

#[test]
fn largest_items_come_first_and_the_listed_folder_is_left_out() {
    let tree = tree();
    let list = |kind, limit| names(&tree, tree.list(0, kind, limit).items);
    assert_eq!(
        list(ListKind::LargestFiles, 10),
        ["b.pdf", "a.bin", "c.dat", "old.txt", "z.txt"]
    );
    assert_eq!(list(ListKind::LargestFolders, 2), ["docs", "deep"]);
    assert_eq!(list(ListKind::Largest, 3), ["docs", "b.pdf", "a.bin"]);
    let docs = id_of(&tree, "docs");
    let below = tree.list(docs, ListKind::Largest, 10).items;
    assert!(!below.contains(&docs));
    // deep and c.dat take 50 each: the folder has the lower id.
    assert_eq!(names(&tree, below)[..3], ["b.pdf", "deep", "c.dat"]);
    assert!(tree.list(0, ListKind::Largest, 0).items.is_empty());
    assert_eq!(
        tree.list(0, ListKind::Largest, usize::MAX).items.len(),
        tree.len() - 1
    );
}

#[test]
fn dates_order_oldest_and_newest_and_skip_unknown_times() {
    let tree = tree();
    let list = |kind, limit| names(&tree, tree.list(0, kind, limit).items);
    assert_eq!(
        list(ListKind::OldestFiles, 10),
        ["old.txt", "b.pdf", "a.bin", "c.dat"]
    );
    assert_eq!(
        list(ListKind::NewestFolders, 10),
        ["void", "deep", "empty", "docs"]
    );
    assert_eq!(list(ListKind::Oldest, 3), ["old.txt", "docs", "b.pdf"]);
    assert_eq!(list(ListKind::Newest, 2), ["void", "c.dat"]);
}

#[test]
fn empty_items_are_listed_by_path() {
    let tree = tree();
    let list = |kind, limit| names(&tree, tree.list(0, kind, limit).items);
    // docs/deep/void comes before empty: a folder comes before the siblings after it.
    assert_eq!(list(ListKind::EmptyFolders, 10), ["void", "empty"]);
    assert_eq!(list(ListKind::EmptyFiles, 10), ["z.txt"]);
    assert_eq!(list(ListKind::Empty, 10), ["void", "empty", "z.txt"]);
    assert_eq!(list(ListKind::Empty, 1), ["void"]);
}

#[test]
fn unreadable_folders_are_not_empty() {
    let mut locked = dir(1, 0, "locked", 1, vec![]);
    locked.flags = flags::IS_DIR | flags::ACCESS_ERROR;
    let tree = Tree::from_records(
        vec![
            dir(0, NO_PARENT, "/r", 1, vec![]),
            locked,
            dir(2, 0, "void", 1, vec![]),
        ],
        META,
    );
    let list = |kind| names(&tree, tree.list(0, kind, 10).items);
    assert_eq!(list(ListKind::EmptyFolders), ["void"]);
    assert_eq!(list(ListKind::Empty), ["void"]);
    // The unreadable folder is still an ordinary item of the other lists.
    assert_eq!(list(ListKind::LargestFolders), ["locked", "void"]);
}

#[test]
fn longest_paths_follow_the_full_path_in_characters() {
    let tree = tree();
    let chars = |id: u32| tree.path(id).to_string_lossy().chars().count();
    let mut expected: Vec<u32> = (1..tree.len() as u32).collect();
    expected.sort_by_key(|&id| (std::cmp::Reverse(chars(id)), id));
    assert_eq!(tree.list(0, ListKind::LongestPaths, 100).items, expected);
    assert_eq!(
        names(&tree, tree.list(0, ListKind::LongestPaths, 1).items),
        ["c.dat"]
    );
    // Characters, not bytes: 4 Cyrillic letters take 8 bytes.
    let words = Tree::from_records(
        vec![dir(
            0,
            NO_PARENT,
            "/r",
            0,
            vec![file("ёёёё", 1, 1), file("abcde", 1, 1)],
        )],
        META,
    );
    assert_eq!(
        names(&words, words.list(0, ListKind::LongestPaths, 2).items),
        ["abcde", "ёёёё"]
    );
}

#[test]
fn equal_scores_are_ordered_by_id() {
    let files = [5u64, 5, 5, 1]
        .iter()
        .enumerate()
        .map(|(i, &size)| file(&format!("f{i}"), size, 0))
        .collect();
    let tree = Tree::from_records(vec![dir(0, NO_PARENT, "/r", 0, files)], META);
    assert_eq!(
        names(&tree, tree.list(0, ListKind::LargestFiles, 2).items),
        ["f0", "f1"]
    );
}

#[test]
fn a_list_reports_whether_more_items_matched_than_the_limit() {
    let tree = tree();
    // 5 files: exactly the limit is not a truncation, one more is.
    assert!(!tree.list(0, ListKind::LargestFiles, 5).truncated);
    assert!(tree.list(0, ListKind::LargestFiles, 4).truncated);
    assert!(!tree.list(0, ListKind::LargestFiles, usize::MAX).truncated);
    // Items left out by the kind do not count: 4 files have a known time.
    assert!(!tree.list(0, ListKind::OldestFiles, 4).truncated);
    assert!(tree.list(0, ListKind::OldestFiles, 3).truncated);
    // Empty lists take the other path through the walk.
    assert!(!tree.list(0, ListKind::Empty, 3).truncated);
    assert!(tree.list(0, ListKind::Empty, 2).truncated);
    assert!(tree.list(0, ListKind::Largest, 0).truncated);
    let nothing = tree.list(0, ListKind::EmptyFiles, 0);
    assert!(nothing.truncated && nothing.items.is_empty());
}

#[test]
fn dead_nodes_are_skipped() {
    let mut tree = sample_tree();
    let mp4 = id_of(&tree, "a.mp4");
    tree.nodes_mut_for_test()[mp4 as usize].flags &= !flags::ALIVE;
    assert!(!tree.list(0, ListKind::Largest, 10).items.contains(&mp4));
    assert!(
        !tree
            .list(0, ListKind::LongestPaths, 10)
            .items
            .contains(&mp4)
    );
}

#[test]
fn deep_trees_need_no_recursion() {
    const DEPTH: u32 = 100_000;
    let dirs = (0..DEPTH)
        .map(|i| match i {
            0 => dir(0, NO_PARENT, "/r", 1, vec![]),
            _ => dir(i, i - 1, "d", 1, vec![]),
        })
        .collect();
    let tree = Tree::from_records(dirs, META);
    let deepest = tree.list(0, ListKind::LongestPaths, 1).items;
    assert_eq!(tree.crumbs(deepest[0]).len(), DEPTH as usize);
    assert_eq!(tree.list(0, ListKind::EmptyFolders, 10).items, deepest);
}
