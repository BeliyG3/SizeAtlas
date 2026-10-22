use super::*;
use crate::tree::{DirRec, FileRec, NO_PARENT, ScanMeta, SizeMode, flags};

fn file(name: &str, size: u64) -> FileRec {
    FileRec {
        name: name.into(),
        size,
        len: size,
        mtime: 0,
        flags: 0,
        ino: None,
    }
}

fn dir(id: u32, parent: u32, name: &str, files: Vec<FileRec>) -> DirRec {
    DirRec {
        id,
        parent,
        name: name.into(),
        mtime: 0,
        flags: 0,
        files,
    }
}

fn locked(mut rec: DirRec) -> DirRec {
    rec.flags |= flags::ACCESS_ERROR;
    rec
}

fn tree(recs: Vec<DirRec>) -> Tree {
    Tree::from_records(
        recs,
        ScanMeta {
            cluster: 4096,
            size_mode: SizeMode::ClusterEstimate,
            scanned_at: 100,
        },
    )
}

/// Id of the node at `path` below the root.
fn at(tree: &Tree, path: &[&str]) -> u32 {
    path.iter().fold(0, |id, name| {
        tree.children(id)
            .find(|&c| tree.name(c) == *name)
            .expect("node exists")
    })
}

fn sample() -> Vec<DirRec> {
    vec![
        dir(0, NO_PARENT, "/r", vec![file("a", 5)]),
        dir(1, 0, "docs", vec![file("b", 30), file("c", 2)]),
        dir(2, 1, "deep", vec![file("d", 40)]),
    ]
}

#[test]
fn unchanged_tree_has_zero_change() {
    let (current, mut base) = (tree(sample()), tree(sample()));
    base.scanned_at = 50;
    let b = compare(&current, &base);
    assert_eq!(b.scanned_at, 50);
    assert_eq!(b.before.len(), current.len());
    for id in 0..current.len() as u32 {
        assert_eq!(
            b.before[id as usize],
            current.node(id).size,
            "{}",
            current.name(id)
        );
    }
    assert_eq!(b.marks, vec![0; current.len()]);
    assert!(b.deleted.is_empty());
}

#[test]
fn grown_folder_and_new_file() {
    let base = tree(vec![
        dir(0, NO_PARENT, "/r", vec![]),
        dir(1, 0, "docs", vec![file("a", 10)]),
    ]);
    let current = tree(vec![
        dir(0, NO_PARENT, "/r", vec![]),
        dir(1, 0, "docs", vec![file("a", 10), file("b", 5)]),
        dir(2, 1, "fresh", vec![file("x", 1)]),
    ]);
    let b = compare(&current, &base);
    let before = |path: &[&str]| b.before[at(&current, path) as usize];
    assert_eq!(before(&[]), 10);
    assert_eq!(before(&["docs"]), 10);
    assert_eq!(before(&["docs", "a"]), 10);
    assert_eq!(before(&["docs", "b"]), NEW);
    assert_eq!(before(&["docs", "fresh"]), NEW);
    assert_eq!(before(&["docs", "fresh", "x"]), NEW);
    assert!(b.deleted.is_empty());
}

#[test]
fn deleted_folder_only_topmost() {
    let base = tree(vec![
        dir(0, NO_PARENT, "/r", vec![file("gone.txt", 2)]),
        dir(1, 0, "keep", vec![file("f", 1)]),
        dir(2, 0, "old", vec![file("y", 3)]),
        dir(3, 2, "a", vec![]),
        dir(4, 3, "b", vec![file("x", 7)]),
    ]);
    let current = tree(vec![
        dir(0, NO_PARENT, "/r", vec![]),
        dir(1, 0, "keep", vec![]),
    ]);
    let b = compare(&current, &base);
    let deleted = |parent, name: &str, size| Deleted {
        parent,
        name: name.into(),
        size,
    };
    let keep = at(&current, &["keep"]);
    assert_eq!(
        b.deleted,
        [
            deleted(0, "gone.txt", 2),
            deleted(0, "old", 10),
            deleted(keep, "f", 1),
        ]
    );
}

#[test]
fn same_names_in_different_folders() {
    let recs = |x, y| {
        vec![
            dir(0, NO_PARENT, "/r", vec![]),
            dir(1, 0, "x", vec![file("data", x)]),
            dir(2, 0, "y", vec![file("data", y)]),
        ]
    };
    let (base, current) = (tree(recs(1, 2)), tree(recs(5, 2)));
    let b = compare(&current, &base);
    assert_eq!(b.before[at(&current, &["x", "data"]) as usize], 1);
    assert_eq!(b.before[at(&current, &["y", "data"]) as usize], 2);
}

#[test]
fn coverage_change_marks_node_and_ancestors() {
    let base = tree(vec![
        dir(0, NO_PARENT, "/r", vec![]),
        dir(1, 0, "a", vec![]),
        locked(dir(2, 1, "locked", vec![])),
        locked(dir(3, 0, "b", vec![])),
    ]);
    let current = tree(vec![
        dir(0, NO_PARENT, "/r", vec![]),
        dir(1, 0, "a", vec![]),
        dir(2, 1, "locked", vec![file("f", 9)]),
        locked(dir(3, 0, "b", vec![])),
    ]);
    let b = compare(&current, &base);
    let marks = |path: &[&str]| b.marks[at(&current, path) as usize];
    assert_eq!(marks(&["a", "locked"]), mark::COVERAGE);
    assert_eq!(marks(&["a"]), mark::APPROX);
    assert_eq!(marks(&[]), mark::APPROX);
    assert_eq!(marks(&["b"]), 0);
    assert_eq!(marks(&["a", "locked", "f"]), 0);
}

#[test]
fn approximate_tree_marks_all() {
    for current_approx in [true, false] {
        let (mut current, mut base) = (tree(sample()), tree(sample()));
        current.approximate = current_approx;
        base.approximate = !current_approx;
        let b = compare(&current, &base);
        assert_eq!(b.marks, vec![mark::APPROX; current.len()]);
    }
}

#[test]
fn deep_tree_10000() {
    let chain = |extra: &[FileRec]| {
        let mut recs = vec![dir(0, NO_PARENT, "/r", vec![])];
        for id in 1..10_000u32 {
            let files = if id == 9_999 { extra.to_vec() } else { vec![] };
            recs.push(dir(id, id - 1, "d", files));
        }
        tree(recs)
    };
    let base = chain(&[file("f", 1)]);
    let current = chain(&[file("f", 1), file("g", 2)]);
    let b = compare(&current, &base);
    let deepest = current.len() as u32 - 1;
    assert_eq!(current.name(deepest), "g");
    assert_eq!(b.before[deepest as usize], NEW);
    assert_eq!(b.before[current.node(deepest).parent as usize], 1);
    assert_eq!(b.before[0], 1);
}

#[test]
fn incompatible_when_size_mode_or_cluster_differs() {
    let base = tree(sample());
    assert!(compatible(&tree(sample()), &base));
    let mut other = tree(sample());
    other.cluster = 512;
    assert!(!compatible(&other, &base));
    let mut other = tree(sample());
    other.size_mode = SizeMode::Logical;
    assert!(!compatible(&other, &base));
    let mut recs = sample();
    recs[0].name = "/elsewhere".into();
    assert!(!compatible(&tree(recs), &base));
}
