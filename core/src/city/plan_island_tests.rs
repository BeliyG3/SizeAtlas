use super::*;
use crate::city::{IslandInput, PolyKind, island};
use crate::tree::{DirRec, NO_PARENT};
use crate::treemap::tests::{dir, file, tree_of};
use std::time::Instant;

const GIB: u64 = 1 << 30;

/// Adds folder `name` under `parent` with `fan[0]` subfolders, each with `fan[1]`, and so on;
/// the files of the last level weigh `leaf` bytes each folder.
fn grow(records: &mut Vec<DirRec>, parent: u32, name: &str, fan: &[usize], leaf: u64) {
    let id = records.len() as u32;
    let files = if fan.is_empty() {
        vec![file("f.bin", leaf)]
    } else {
        Vec::new()
    };
    records.push(dir(id, parent, name, files));
    if let Some((&n, rest)) = fan.split_first() {
        for k in 0..n {
            grow(records, id, &format!("n{k}"), rest, leaf);
        }
    }
}

/// Is `id` in the folder named `top` right under the root?
fn under(tree: &Tree, id: u32, top: &str) -> bool {
    let mut cur = id;
    while tree.node(cur).parent != 0 && tree.node(cur).parent != NO_PARENT {
        cur = tree.node(cur).parent;
    }
    tree.name(cur) == top
}

/// The reviewer's drive: 990 GiB, of it `a` 900 GiB in 20 folders of 4 of 3, `b` 50 GiB and
/// `c` 40 GiB in 10 folders of 3.
fn drive() -> Tree {
    let mut records = vec![dir(0, NO_PARENT, "/r", Vec::new())];
    grow(&mut records, 0, "a", &[20, 4, 3], 900 * GIB / 240);
    grow(&mut records, 0, "b", &[10, 3], 50 * GIB / 30);
    grow(&mut records, 0, "c", &[10, 3], 40 * GIB / 30);
    tree_of(records)
}

#[test]
fn districts_split_from_a_big_folder_have_houses() {
    let tree = drive();
    let root = island_summary(&tree, 0);
    let out = districts(&root);
    let split: Vec<&District> = out.iter().filter(|d| under(&tree, d.id, "a")).collect();
    assert!(split.len() >= 8, "{}", split.len());
    // Every block of every district knows its subfolders: the houses.
    for d in out.iter().filter(|d| d.id != root.id) {
        assert!(d.blocks.iter().all(|b| !b.children.is_empty()), "{}", d.id);
    }
    // The summary chose what `districts` chose: the same split from a plain depth-5 summary.
    assert_eq!(out, districts(&summary(&tree, 0, 5)));

    let island = island(&IslandInput {
        root,
        free: 100 * GIB,
        neighbours: vec![1.0],
        seed: 4,
    });
    let houses: Vec<_> = island
        .polys
        .iter()
        .filter(|p| p.kind == PolyKind::House)
        .collect();
    for d in &split {
        let own = houses.iter().any(|h| {
            island
                .polys
                .iter()
                .any(|b| b.kind == PolyKind::Block && b.id == h.parent && b.parent == d.id)
        });
        assert!(own, "district {} has no house", d.id);
    }
    let tallest = houses.iter().max_by_key(|h| h.size).unwrap();
    assert!(
        under(&tree, tallest.id, "a"),
        "{}",
        tree.path(tallest.id).display()
    );
}

#[test]
fn a_flat_root_opens_a_bounded_number_of_folders() {
    // 200 alike folders: none is big, so each would be opened in turn, then their subfolders.
    let mut records = vec![dir(0, NO_PARENT, "/r", Vec::new())];
    for k in 0..200 {
        grow(&mut records, 0, &format!("d{k:03}"), &[3, 2, 2], GIB);
    }
    let tree = tree_of(records);
    let root = island_summary(&tree, 0);
    assert_eq!(root.children.len(), 200);
    // An opened folder keeps three levels below it, the others two.
    let deep = root
        .children
        .iter()
        .flat_map(|f| &f.children)
        .filter(|c| c.children.iter().any(|h| !h.children.is_empty()))
        .count();
    assert_eq!(deep, 3 * MAX_OPEN);
}

/// About 1.1 million folders and 0.9 million files: `a` holds 90% and opens a few times.
fn big_drive() -> Tree {
    let mut records = vec![dir(0, NO_PARENT, "/r", Vec::new())];
    grow(&mut records, 0, "a", &[1, 3, 50, 40, 30, 4], 1 << 20);
    for k in 0..3 {
        grow(
            &mut records,
            0,
            &format!("s{k}"),
            &[20, 20, 20, 5],
            600 << 10,
        );
    }
    tree_of(records)
}

/// 5 000 alike folders of 20 of 10: the opening stops at `MAX_OPEN`.
fn flat_drive() -> Tree {
    let mut records = vec![dir(0, NO_PARENT, "/r", Vec::new())];
    for k in 0..5000 {
        grow(&mut records, 0, &format!("d{k:04}"), &[20, 10], GIB);
    }
    tree_of(records)
}

#[test]
#[ignore = "timing, run in release: cargo test -p sizeatlas-core --release -- --ignored"]
fn large_trees_summarise_and_build_under_two_seconds() {
    for (name, tree) in [("deep", big_drive()), ("flat", flat_drive())] {
        let start = Instant::now();
        let root = island_summary(&tree, 0);
        let summed = start.elapsed().as_secs_f32();
        let mut count = 0;
        let mut stack = vec![&root];
        while let Some(f) = stack.pop() {
            count += 1;
            stack.extend(&f.children);
        }
        let island = island(&IslandInput {
            root,
            free: 100 * GIB,
            neighbours: vec![1.0, 3.0],
            seed: 9,
        });
        let took = start.elapsed().as_secs_f32();
        let houses = island.polys.iter().filter(|p| p.kind == PolyKind::House);
        eprintln!(
            "{name}: {} nodes, summary {summed:.3} s of {count} folders, island {took:.3} s, {} houses",
            tree.len(),
            houses.count()
        );
        assert!(took < 2.0, "{name}: {took} s");
    }
}
