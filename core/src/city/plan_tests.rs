use super::*;
use crate::tree::NO_PARENT;
use crate::treemap::tests::{dir, file, tree_of};

fn leaf(id: u32, size: u64) -> Folder {
    Folder {
        id,
        size,
        children: Vec::new(),
    }
}

fn folder(id: u32, files: u64, children: Vec<Folder>) -> Folder {
    let size = files + children.iter().map(|c| c.size).sum::<u64>();
    Folder { id, size, children }
}

fn child(tree: &Tree, of: u32, name: &str) -> u32 {
    tree.children(of).find(|&c| tree.name(c) == name).unwrap()
}

#[test]
fn summary_stops_at_the_depth() {
    let tree = tree_of(vec![
        dir(0, NO_PARENT, "/r", vec![file("top.bin", 7)]),
        dir(1, 0, "a", vec![file("a.bin", 10)]),
        dir(2, 1, "b", vec![file("b.bin", 20)]),
        dir(3, 2, "c", vec![file("c.bin", 30)]),
        dir(4, 0, "empty", vec![]),
        dir(5, 0, "z", vec![file("z.bin", 100)]),
    ]);
    let root = summary(&tree, 0, 2);
    let (a, z) = (child(&tree, 0, "a"), child(&tree, 0, "z"));
    let b = child(&tree, a, "b");
    assert_eq!(root.id, 0);
    assert_eq!(root.size, 167);
    assert_eq!(root.files(), 7);
    // Biggest first, the empty folder dropped.
    let ids: Vec<u32> = root.children.iter().map(|c| c.id).collect();
    assert_eq!(ids, vec![z, a]);
    let a_sum = &root.children[1];
    assert_eq!(a_sum.size, 60);
    assert_eq!(a_sum.children.len(), 1);
    // Level 2 is the last one: `b` keeps its size but not `c`.
    assert_eq!(a_sum.children[0].id, b);
    assert_eq!(a_sum.children[0].size, 50);
    assert!(a_sum.children[0].children.is_empty());
    assert_eq!(a_sum.children[0].files(), 50);
    assert!(summary(&tree, 0, 0).children.is_empty());
}

#[test]
fn districts_expand_the_biggest_until_eight_are_big() {
    let huge = |id: u32| folder(id, 0, (0..10).map(|k| leaf(id * 100 + k, 1000)).collect());
    let root = folder(0, 5, vec![huge(1), huge(2)]);
    let out = districts(&root);
    assert!(out.len() >= 8, "{}", out.len());
    assert!(out.len() <= MAX_DISTRICTS + 1);
    // The size is kept whole.
    assert_eq!(out.iter().map(|d| d.size).sum::<u64>(), root.size);
    // The core comes first and is the biggest.
    assert!(out.iter().all(|d| d.size <= out[0].size));
}

#[test]
fn the_rest_goes_to_one_district_of_the_root() {
    let kids: Vec<Folder> = (1..=30)
        .map(|i| folder(i, 0, vec![leaf(1000 + i, 1000 * u64::from(i))]))
        .collect();
    let root = folder(0, 77, kids);
    let out = districts(&root);
    assert!(out.len() <= 15, "{}", out.len());
    let rest = out.last().unwrap();
    assert_eq!(rest.id, root.id);
    assert_eq!(rest.files, 77);
    assert_eq!(rest.blocks.len(), 30 - (out.len() - 1));
    assert_eq!(out.iter().map(|d| d.size).sum::<u64>(), root.size);
    // A folder district carries its subfolders as blocks.
    assert_eq!(out[0].id, 30);
    assert_eq!(out[0].blocks.len(), 1);
}

#[test]
fn a_root_without_folders_is_one_district() {
    let out = districts(&leaf(9, 500));
    assert_eq!(out.len(), 1);
    assert_eq!((out[0].id, out[0].size, out[0].files), (9, 500, 500));
    assert_eq!(districts(&leaf(9, 0)).len(), 1);
}

#[test]
fn built_area_and_ratio_follow_the_formulas() {
    assert!((built_area(1 << 30) - 250_000.0).abs() < 1.0);
    assert_eq!(built_area(0), 150_000.0);
    assert_eq!(built_area(u64::MAX), 1_500_000.0);
    assert_eq!(empty_ratio(1000, 0), 0.0);
    assert_eq!(empty_ratio(1000, 10_000), 3.0);
    assert!((empty_ratio(1000, 500) - 0.5).abs() < 1e-6);
    assert_eq!(empty_ratio(0, 500), 0.0);
}
