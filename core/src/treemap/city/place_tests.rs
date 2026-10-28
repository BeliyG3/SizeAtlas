use super::super::*;
use crate::tree::{DirRec, NO_PARENT};
use crate::treemap::city::tests::{ROOT, named};
use crate::treemap::tests::{dir, file, tree_of};

const EPS: f32 = 1e-3;

/// One folder of 10^9 bytes and six of 1 byte below the root, each with a subfolder.
fn unbalanced() -> Tree {
    let mut recs = vec![dir(0, NO_PARENT, "/r", vec![])];
    for (i, size) in [1_000_000_000].into_iter().chain([1; 6]).enumerate() {
        let top = recs.len() as u32;
        recs.push(dir(top, 0, &format!("d{i}"), vec![]));
        recs.push(dir(top + 1, top, "sub", vec![file("f", size)]));
    }
    tree_of(recs)
}

#[test]
fn tiny_districts_keep_their_minimum_side() {
    let tree = unbalanced();
    let (_, lots) = city_layout(&tree, ROOT);
    let min = min_side(0) as f32 - EPS;
    for i in 1..=6 {
        let lot = named(&tree, &lots, &format!("d{i}"));
        assert_eq!((lot.depth, lot.size), (0, 1));
        assert!(lot.w >= min && lot.h >= min, "{lot:?}");
    }
}

#[test]
fn no_lot_comes_out_thinner_than_a_metre() {
    let tree = unbalanced();
    let (_, lots) = city_layout(&tree, ROOT);
    assert!(lots.len() >= 7);
    for lot in &lots {
        assert!(lot.w >= 1.0 && lot.h >= 1.0, "{lot:?}");
    }
}

#[test]
fn a_block_too_small_for_its_children_stays_a_building() {
    // Root -> D -> {H: one huge folder, s0..s7: 20 one-byte folders each}.
    let mut recs: Vec<DirRec> = vec![dir(0, NO_PARENT, "/r", vec![]), dir(1, 0, "D", vec![])];
    recs.push(dir(2, 1, "H", vec![]));
    recs.push(dir(3, 2, "h", vec![file("f", 1_000_000_000)]));
    for s in 0..8 {
        let block = recs.len() as u32;
        recs.push(dir(block, 1, &format!("s{s}"), vec![]));
        for j in 0..20 {
            let id = recs.len() as u32;
            recs.push(dir(id, block, &format!("k{j:02}"), vec![file("f", 1)]));
        }
    }
    let tree = tree_of(recs);
    let (_, lots) = city_layout(&tree, ROOT);
    assert_eq!(named(&tree, &lots, "D").kind, LotKind::District);
    assert_eq!(named(&tree, &lots, "H").kind, LotKind::Block);
    for s in 0..8 {
        let block = named(&tree, &lots, &format!("s{s}"));
        assert_eq!(
            (block.kind, block.depth, block.size),
            (LotKind::Building, 1, 20)
        );
        let inside = |l: &&Lot| l.id == block.id || tree.node(l.id).parent == block.id;
        assert_eq!(lots.iter().filter(inside).count(), 1, "s{s} has children");
    }
}
