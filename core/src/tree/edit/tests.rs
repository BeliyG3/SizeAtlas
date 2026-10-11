use std::path::Path;

use super::*;
use crate::tree::{FileRec, ListKind, ListOrder, NO_PARENT, ScanMeta, SizeMode};

pub(super) const META: ScanMeta = ScanMeta {
    cluster: 0,
    size_mode: SizeMode::Logical,
    scanned_at: 0,
};

pub(super) fn file(name: &str, size: u64) -> FileRec {
    FileRec {
        name: name.into(),
        size,
        len: size,
        mtime: 1,
        flags: 0,
        ino: None,
    }
}

fn dir(id: u32, parent: u32, name: &str, files: Vec<FileRec>) -> DirRec {
    DirRec {
        id,
        parent,
        name: name.into(),
        mtime: 1,
        flags: 0,
        files,
    }
}

/// ```text
/// /r          f 1
///   A         x 10
///     B       y 100
/// ```
fn tree() -> Tree {
    Tree::from_records(
        vec![
            dir(0, NO_PARENT, "/r", vec![file("f", 1)]),
            dir(1, 0, "A", vec![file("x", 10)]),
            dir(2, 1, "B", vec![file("y", 100)]),
        ],
        META,
    )
}

fn child(tree: &Tree, id: u32, name: &str) -> u32 {
    tree.children(id)
        .find(|&c| tree.name(c) == name)
        .expect("child exists")
}

fn names(tree: &Tree, id: u32) -> Vec<&str> {
    tree.children(id).map(|c| tree.name(c)).collect()
}

fn totals(tree: &Tree, id: u32) -> (u64, u32, u64, u32) {
    let n = tree.node(id);
    (n.size, n.files, n.len, n.dirs)
}

#[test]
fn a_replaced_folder_keeps_its_id_and_its_ancestors_get_the_difference() {
    let mut tree = tree();
    let a = child(&tree, 0, "A");
    let (b, x) = (child(&tree, a, "B"), child(&tree, a, "x"));
    let y = child(&tree, b, "y");
    let mut fresh = dir(0, NO_PARENT, "ignored", vec![file("z", 5)]);
    fresh.mtime = 9;
    let records = vec![fresh, dir(1, 0, "C", vec![file("w", 7)])];
    tree.replace_subtree(a, records);

    tree.assert_invariants();
    assert!(tree.get(a).is_some(), "the folder itself stays");
    assert_eq!(tree.name(a), "A", "it keeps its name");
    assert_eq!(tree.node(a).mtime, 9);
    assert_eq!(
        totals(&tree, a),
        (12, 2, 12, 1),
        "the new totals, not doubled"
    );
    assert_eq!(totals(&tree, 0), (13, 3, 13, 2));
    assert_eq!(names(&tree, a), ["C", "z"]);
    for old in [b, x, y] {
        assert!(tree.get(old).is_none(), "old contents are dead");
    }
    assert_eq!((tree.live, tree.dead, tree.rev), (6, 3, 1));
}

#[test]
fn a_removed_item_leaves_every_total_of_its_ancestors() {
    let mut tree = tree();
    let a = child(&tree, 0, "A");
    let b = child(&tree, a, "B");
    let y = child(&tree, b, "y");
    tree.remove(b);
    tree.assert_invariants();
    assert!(tree.get(b).is_none() && tree.get(y).is_none());
    assert_eq!(totals(&tree, a), (10, 1, 10, 0));
    assert_eq!(totals(&tree, 0), (11, 2, 11, 1));
    assert_eq!(
        tree.node(a).child_count,
        2,
        "the block stays, the walks skip the dead"
    );
    assert_eq!(names(&tree, a), ["x"]);
    assert_eq!((tree.live, tree.dead, tree.rev), (4, 2, 1));

    tree.remove(child(&tree, 0, "f"));
    tree.set_mtime(0, 42);
    assert_eq!(
        (tree.node(0).files, tree.node(0).mtime, tree.rev),
        (1, 42, 2)
    );
    tree.assert_invariants();
}

#[test]
fn walks_skip_what_was_removed_or_replaced() {
    let mut tree = tree();
    let a = child(&tree, 0, "A");
    tree.remove(child(&tree, a, "B"));
    let fresh = vec![dir(0, NO_PARENT, "A", vec![file("n", 3), file("x", 10)])];
    tree.replace_subtree(a, fresh);
    // Alive: the root, f, A and the new n and x.
    let listed = tree.list(0, ListKind::Largest, usize::MAX).items;
    assert!(listed.iter().all(|&id| tree.get(id).is_some()));
    assert_eq!(listed.len(), 4);
    let stats = tree.type_stats(0);
    assert_eq!(stats.iter().map(|s| s.files).sum::<u64>(), 3);
    let rects = crate::treemap::layout(&tree, 0, 400.0, 400.0, crate::treemap::MAX_RECTS);
    assert!(rects.iter().all(|r| tree.get(r.id).is_some()));
    assert_eq!(tree.children_page(0, 0, 10, ListOrder::DEFAULT).total, 2);
    assert_eq!(tree.children_page(a, 0, 10, ListOrder::DEFAULT).total, 2);
    assert_eq!(tree.compact_snapshot().len(), 5);
}

#[test]
fn live_ancestor_climbs_to_the_nearest_live_node() {
    let mut tree = tree();
    let a = child(&tree, 0, "A");
    let b = child(&tree, a, "B");
    let y = child(&tree, b, "y");
    let x = child(&tree, a, "x");
    tree.remove(b);
    assert_eq!(tree.live_ancestor(y), a);
    assert_eq!(tree.live_ancestor(x), x);
    tree.replace_subtree(a, vec![dir(0, NO_PARENT, "A", vec![])]);
    assert_eq!(tree.live_ancestor(x), a);
    assert_eq!(tree.live_ancestor(a), a);
}

#[test]
fn hard_links_make_the_tree_approximate_and_unreadable_folders_are_counted() {
    let mut locked = dir(3, 1, "locked", vec![]);
    locked.flags = flags::ACCESS_ERROR;
    let link = FileRec {
        ino: Some((1, 7)),
        ..file("l", 3)
    };
    let mut tree = Tree::from_records(
        vec![
            dir(0, NO_PARENT, "/r", vec![]),
            dir(1, 0, "A", vec![link]),
            dir(2, 0, "B", vec![]),
            locked,
        ],
        META,
    );
    assert_eq!((tree.access_errors, tree.approximate), (1, false));
    let a = child(&tree, 0, "A");
    tree.replace_subtree(a, vec![dir(0, NO_PARENT, "A", vec![])]);
    assert_eq!((tree.access_errors, tree.approximate), (0, true));

    let mut unreadable = dir(0, NO_PARENT, "B", vec![]);
    unreadable.flags = flags::ACCESS_ERROR;
    let b = child(&tree, 0, "B");
    tree.replace_subtree(b, vec![unreadable]);
    assert_eq!(tree.access_errors, 1);
    tree.remove(b);
    assert_eq!(tree.access_errors, 0);
    tree.assert_invariants();
}

#[test]
fn removing_a_hard_link_makes_the_tree_approximate() {
    let link = FileRec {
        ino: Some((1, 7)),
        ..file("l", 3)
    };
    let records = vec![dir(0, NO_PARENT, "/r", vec![link, file("p", 1)])];
    let mut tree = Tree::from_records(records, META);
    tree.remove(child(&tree, 0, "p"));
    assert!(!tree.approximate);
    tree.remove(child(&tree, 0, "l"));
    assert!(
        tree.approximate,
        "the other links of the file may now hold its size"
    );
}

#[test]
fn compact_drops_the_dead_and_hands_back_the_old_tree() {
    let mut tree = tree();
    let a = child(&tree, 0, "A");
    tree.remove(child(&tree, a, "B"));
    let expected = tree.compact_snapshot();
    let old = tree.compact();
    assert_eq!(tree, expected);
    assert_eq!(
        (tree.dead, tree.live as usize, tree.rev),
        (0, tree.len(), 1)
    );
    assert_eq!((old.dead, old.len()), (2, 6));
    tree.check_structure().unwrap();
    tree.assert_invariants();
}

#[test]
fn deep_subtrees_change_without_recursion() {
    const DEPTH: u32 = 100_000;
    let records = (0..DEPTH)
        .map(|i| match i {
            0 => dir(0, NO_PARENT, "/r", vec![]),
            _ => dir(i, i - 1, "d", vec![file("f", 1)]),
        })
        .collect();
    let mut tree = Tree::from_records(records, META);
    let top = tree.children(0).next().unwrap();
    let deep = tree.crumbs(tree.len() as u32 - 1)[2];
    tree.replace_subtree(deep, vec![dir(0, NO_PARENT, "d", vec![])]);
    assert_eq!(
        tree.node(0).files,
        1,
        "only the file of the top folder is left"
    );
    tree.remove(top);
    assert_eq!((tree.live, tree.node(0).files), (1, 0));
}

#[test]
#[should_panic(expected = "the root")]
fn the_root_is_never_removed() {
    tree().remove(0);
}

#[test]
fn find_path_walks_the_names_from_the_root() {
    let mut tree = tree();
    let a = child(&tree, 0, "A");
    let b = child(&tree, a, "B");
    assert_eq!(tree.find_path(&tree.path(b)), Some(b));
    assert_eq!(tree.find_path(Path::new("/r")), Some(0));
    assert_eq!(tree.find_path(&tree.path(a).join("nope")), None);
    assert_eq!(tree.find_path(Path::new("/elsewhere/A")), None);
    tree.remove(b);
    assert_eq!(
        tree.find_path(&tree.path(b)),
        None,
        "dead nodes are not found"
    );
}
