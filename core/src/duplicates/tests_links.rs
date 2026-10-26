//! Hard links on real files: links of one file are one copy; a link outside the searched roots
//! keeps its copy on disk.

use std::fs;
use std::path::Path;

use super::tests::*;

fn link(from: &Path, to: &Path) {
    fs::create_dir_all(to.parent().unwrap()).unwrap();
    fs::hard_link(from, to).unwrap();
    settle(to);
    settle(from);
}

#[test]
fn hard_links_are_one_copy() {
    let d = dir();
    let a = put(d.path(), "A", &data(5000));
    link(&a, &d.path().join("B"));
    put(d.path(), "C", &data(5000));
    let (groups, _, _) = run(&[&scan_of(d.path())], "", &cache());
    assert_eq!(groups.len(), 1);
    let objects = &groups[0].objects;
    assert_eq!(objects.len(), 2);
    let ab = objects
        .iter()
        .find(|o| o.paths.len() == 2)
        .expect("A and B are one object");
    assert!(ab.trashable());
    let c = objects.iter().find(|o| o.paths.len() == 1).unwrap();
    assert_eq!(groups[0].free(), c.size());
}

#[test]
fn a_link_outside_the_root_holds_its_copy() {
    let d = dir();
    let root = d.path().join("root");
    let out = d.path().join("out");
    let a = put(&root, "A", &data(5000));
    link(&a, &out.join("A2"));
    put(&root, "C", &data(5000));
    let (groups, _, _) = run(&[&scan_of(&root)], "", &cache());
    assert_eq!(all_names(&groups), [["A", "C"]]);
    let [a, c] = &groups[0].objects[..] else {
        panic!("two objects")
    };
    assert!(a.outside_links());
    assert!(!a.trashable());
    assert_eq!(groups[0].free(), c.size());

    let b = put(&root, "B", &data(5000));
    link(&b, &out.join("B2"));
    let (groups, _, _) = run(&[&scan_of(&root)], "", &cache());
    assert_eq!(all_names(&groups), [["A", "B", "C"]]);
    let c = &groups[0].objects[2];
    assert_eq!(groups[0].free(), c.size());
}

#[test]
fn two_links_only_are_no_group() {
    let d = dir();
    let a = put(d.path(), "A", &data(5000));
    link(&a, &d.path().join("B"));
    let (groups, out, _) = run(&[&scan_of(d.path())], "", &cache());
    assert!(groups.is_empty());
    assert_eq!(out.stats.opened, 2);
}
