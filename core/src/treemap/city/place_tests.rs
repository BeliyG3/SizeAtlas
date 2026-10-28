use super::super::*;
use crate::tree::NO_PARENT;
use crate::treemap::city::tests::{ROOT, balanced, named};
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
fn tiny_districts_keep_room_for_their_children() {
    let tree = unbalanced();
    let (_, lots) = city_layout(&tree, ROOT);
    // One depth-1 building inside the highway room.
    let least = 1.25 * (MIN_BUILDING + 2.0 * inset(1)) + 2.0 * inset(0) - EPS;
    assert!(least > MIN_BLOCK + 2.0 * inset(0));
    for i in 1..=6 {
        let lot = named(&tree, &lots, &format!("d{i}"));
        assert_eq!((lot.kind, lot.depth, lot.size), (LotKind::District, 0, 1));
        assert!(lot.w >= least && lot.h >= least, "{lot:?}");
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
fn districts_without_room_at_the_cap_stay_buildings() {
    // 24 × 24 × 24 folders need a field far wider than the cap.
    let tree = tree_of(balanced(&[24, 24, 24], 1));
    let (side, lots) = city_layout_with(&tree, ROOT, usize::MAX);
    assert_eq!(side, 2400.0);
    let collapsed: Vec<&Lot> = lots
        .iter()
        .filter(|l| l.kind == LotKind::Building && l.depth < 2)
        .collect();
    assert!(!collapsed.is_empty());
    for c in collapsed {
        assert!(tree.children(c.id).any(|k| tree.node(k).is_dir()));
        assert!(!lots.iter().any(
            |l| tree.node(l.id).parent == c.id || (l.id == c.id && l.kind != LotKind::Building)
        ));
    }
    for lot in &lots {
        let least = match lot.kind {
            LotKind::District | LotKind::Block => MIN_BLOCK,
            _ => MIN_BUILDING,
        } + 2.0 * inset(lot.depth)
            - EPS;
        assert!(lot.w >= least && lot.h >= least, "{lot:?}");
    }
}
