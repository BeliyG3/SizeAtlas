//! A search of one folder of a root: the walk starts at it, zones still count from the root.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use super::group::Group;
use super::tests::*;
use crate::tree::Tree;

/// The node at the relative path `rel` (`/`-separated) of `tree`.
fn at(tree: &Tree, rel: &str) -> u32 {
    rel.split('/').fold(0, |id, part| {
        tree.children(id).find(|&c| tree.name(c) == part).unwrap()
    })
}

/// The groups of `tree` walked from `start`.
fn from(tree: &Tree, start: u32) -> Vec<Group> {
    let prepared = prepared_from(&[(tree, start)], "");
    finish(prepared, &cache(), &AtomicBool::new(false), false).0
}

/// `a/x.jpg`, `a/y.jpg` and `b/z.jpg` below `base`, all with the same bytes.
fn three(base: &Path) {
    let bytes = data(8192);
    for rel in ["a/x.jpg", "a/y.jpg", "b/z.jpg"] {
        put(base, rel, &bytes);
    }
}

#[test]
fn search_from_a_folder_finds_only_its_copies() {
    let d = dir();
    three(d.path());
    let tree = scan_of(d.path());
    let groups = from(&tree, at(&tree, "a"));
    assert_eq!(all_names(&groups), [["x.jpg", "y.jpg"]]);
}

#[test]
fn start_zero_is_the_whole_root() {
    let d = dir();
    three(d.path());
    let tree = scan_of(d.path());
    let groups = from(&tree, 0);
    assert_eq!(all_names(&groups), [["x.jpg", "y.jpg", "z.jpg"]]);
    let whole = run(&[&tree], "", &cache()).0;
    assert_eq!(all_names(&groups), all_names(&whole));
}

#[test]
fn a_zone_above_the_folder_still_counts() {
    let d = dir();
    let bytes = data(8192);
    put(d.path(), "node_modules/a/x.jpg", &bytes);
    put(d.path(), "node_modules/a/y.jpg", &bytes);
    let tree = scan_of(d.path());
    let start = at(&tree, "node_modules/a");
    assert!(from(&tree, start).is_empty());
}

#[test]
fn a_file_or_a_missing_node_gives_nothing() {
    let d = dir();
    three(d.path());
    let tree = scan_of(d.path());
    assert!(from(&tree, at(&tree, "a/x.jpg")).is_empty());
    assert!(from(&tree, tree.len() as u32).is_empty());
}
