use super::*;
use crate::tree::{DirRec, NO_PARENT, sample_tree};
use crate::treemap::tests::{dir, file, tree_of};

pub(super) const ROOT: u32 = 0;
const EPS: f32 = 1e-3;

fn is_building(lot: &Lot) -> bool {
    matches!(
        lot.kind,
        LotKind::Building | LotKind::Annex | LotKind::Others
    )
}

/// The folder lot named `name`.
pub(super) fn named<'a>(tree: &Tree, lots: &'a [Lot], name: &str) -> &'a Lot {
    lots.iter()
        .find(|l| !matches!(l.kind, LotKind::Annex | LotKind::Others) && tree.name(l.id) == name)
        .unwrap_or_else(|| panic!("no lot {name}"))
}

/// Id of the expanded folder (or the root) whose interior holds `lot`.
fn parent_id(tree: &Tree, lot: &Lot) -> u32 {
    match lot.kind {
        LotKind::Annex | LotKind::Others => lot.id,
        _ => tree.node(lot.id).parent,
    }
}

/// Records of a full tree: the root has `fanout[0]` folders, each of them `fanout[1]`, and
/// so on; every folder of the last level holds one file of `size`.
fn balanced(fanout: &[u32], size: u64) -> Vec<DirRec> {
    fn grow(recs: &mut Vec<DirRec>, parent: u32, fanout: &[u32], size: u64) {
        let Some((&n, rest)) = fanout.split_first() else {
            recs[parent as usize].files.push(file("f", size));
            return;
        };
        for i in 0..n {
            let id = recs.len() as u32;
            recs.push(dir(id, parent, &format!("n{i:02}"), vec![]));
            grow(recs, id, rest, size);
        }
    }
    let mut recs = vec![dir(0, NO_PARENT, "/r", vec![])];
    grow(&mut recs, 0, fanout, size);
    recs
}

#[test]
fn folders_become_districts_and_buildings() {
    let tree = tree_of(vec![
        dir(0, NO_PARENT, "/r", vec![file("r", 10)]),
        dir(1, 0, "A", vec![]),
        dir(2, 1, "a1", vec![file("x", 100)]),
        dir(3, 1, "a2", vec![file("y", 50)]),
        dir(4, 0, "B", vec![file("z", 30)]),
    ]);
    let (_, lots) = city_layout(&tree, ROOT);
    assert_eq!(lots.len(), 5, "{lots:?}");
    let a = named(&tree, &lots, "A");
    assert_eq!((a.kind, a.depth, a.size), (LotKind::District, 0, 150));
    for name in ["a1", "a2"] {
        let l = named(&tree, &lots, name);
        assert_eq!((l.kind, l.depth), (LotKind::Building, 1));
    }
    let b = named(&tree, &lots, "B");
    assert_eq!((b.kind, b.depth), (LotKind::Building, 0));
    let annex = lots.iter().find(|l| l.kind == LotKind::Annex).unwrap();
    assert_eq!((annex.id, annex.depth, annex.size), (ROOT, 0, 10));
}

#[test]
fn depth_stops_at_two() {
    let tree = tree_of(balanced(&[1; 6], 64));
    let (_, lots) = city_layout(&tree, ROOT);
    assert_eq!(lots.iter().map(|l| l.depth).max(), Some(2));
    let deepest = lots.iter().find(|l| l.depth == 2).unwrap();
    assert_eq!(deepest.kind, LotKind::Building);
    let up = |id: u32| tree.node(id).parent;
    assert_eq!(up(up(up(deepest.id))), ROOT, "the third folder down");
    assert_eq!(deepest.size, 64);
}

#[test]
fn children_sit_inside_the_parent_with_road_room() {
    // Districts with an Others lot, blocks, and an Annex at every level.
    let mut recs = balanced(&[5, 30, 3], 7);
    for rec in &mut recs {
        rec.files.push(file("own", 2));
    }
    let tree = tree_of(recs);
    let (side, lots) = city_layout(&tree, ROOT);
    assert!(lots.iter().any(|l| l.kind == LotKind::Block));
    assert!(lots.iter().any(|l| l.kind == LotKind::Others));
    for c in &lots {
        let pid = parent_id(&tree, c);
        let (x, y, w, h) = match lots
            .iter()
            .find(|p| p.id == pid && matches!(p.kind, LotKind::District | LotKind::Block))
        {
            Some(p) => {
                let i = inset(p.depth);
                (p.x + i, p.y + i, p.w - 2.0 * i, p.h - 2.0 * i)
            }
            None => {
                assert_eq!(pid, ROOT);
                (0.0, 0.0, side, side)
            }
        };
        assert!(
            c.x >= x - EPS
                && c.y >= y - EPS
                && c.x + c.w <= x + w + EPS
                && c.y + c.h <= y + h + EPS,
            "{c:?} outside its parent"
        );
    }
    for (i, a) in lots.iter().enumerate() {
        for b in lots[i + 1..]
            .iter()
            .filter(|b| parent_id(&tree, b) == parent_id(&tree, a))
        {
            let w = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
            let h = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
            assert!(w <= EPS || h <= EPS, "{a:?} overlaps {b:?}");
        }
    }
}

#[test]
fn many_small_children_go_to_others() {
    let recs = std::iter::once(dir(0, NO_PARENT, "/r", vec![]))
        .chain((1..=30).map(|id| {
            dir(
                id,
                0,
                &format!("d{id:02}"),
                vec![file("f", 1000 - u64::from(id))],
            )
        }))
        .collect();
    let tree = tree_of(recs);
    let (_, lots) = city_layout(&tree, ROOT);
    let folders = lots.iter().filter(|l| l.kind == LotKind::Building).count();
    assert_eq!(folders, 24);
    let others: Vec<&Lot> = lots.iter().filter(|l| l.kind == LotKind::Others).collect();
    assert_eq!(others.len(), 1);
    assert_eq!(others[0].id, ROOT);
    // The six smallest folders are d25..d30.
    assert_eq!(others[0].size, (25..=30).map(|id| 1000 - id).sum::<u64>());
}

#[test]
fn the_budget_holds() {
    let tree = tree_of(balanced(&[50, 50], 3));
    let (_, lots) = city_layout_with(&tree, ROOT, 100);
    let buildings = lots.iter().filter(|l| is_building(l)).count();
    assert!(buildings <= 100, "{buildings}");
}

#[test]
fn blocks_keep_their_minimum_in_a_balanced_tree() {
    let recs = balanced(&[4, 4, 4], 10);
    let tree = tree_of(recs);
    let (_, lots) = city_layout(&tree, ROOT);
    let blocks: Vec<&Lot> = lots.iter().filter(|l| l.kind == LotKind::Block).collect();
    assert_eq!(blocks.len(), 16);
    let min = MIN_BLOCK + 2.0 * inset(1) - EPS;
    for b in blocks {
        assert!(b.w >= min && b.h >= min, "{b:?}");
    }
}

#[test]
fn a_root_without_folders_is_one_annex() {
    let tree = tree_of(vec![dir(
        0,
        NO_PARENT,
        "/r",
        vec![file("a", 5), file("b", 6), file("c", 7)],
    )]);
    let (side, lots) = city_layout(&tree, ROOT);
    assert_eq!(side, 400.0);
    assert_eq!(
        lots,
        [Lot {
            x: 0.0,
            y: 0.0,
            w: side,
            h: side,
            id: ROOT,
            kind: LotKind::Annex,
            depth: 0,
            size: 18,
        }]
    );
}

#[test]
fn field_side_clamps() {
    assert_eq!(field_side(1), 400.0);
    assert_eq!(field_side(100), 400.0);
    assert_eq!(field_side(2_500), 2000.0);
    assert_eq!(field_side(1_000_000), 2400.0);
}

#[test]
fn encoding_puts_the_field_the_format_and_the_records_at_fixed_offsets() {
    let tree = sample_tree();
    let (_, lots) = city_layout(&tree, ROOT);
    assert!(lots.len() > 1);
    let bytes = encode_city(7, 9, true, 512.0, &lots);
    assert_eq!(bytes.len(), CITY_HEADER_LEN + CITY_RECORD_LEN * lots.len());
    assert_eq!(
        bytes[..24],
        super::super::header(7, 9, true, lots.len(), 0)[..]
    );
    let f32_at = |at: usize| f32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    assert_eq!(f32_at(24), 512.0);
    assert_eq!(u32_at(28), CITY_FORMAT);
    assert_eq!(CITY_FORMAT, 2);
    for (i, lot) in lots.iter().enumerate() {
        let at = CITY_HEADER_LEN + CITY_RECORD_LEN * i;
        assert_eq!(
            [f32_at(at), f32_at(at + 4), f32_at(at + 8), f32_at(at + 12)],
            [lot.x, lot.y, lot.w, lot.h]
        );
        assert_eq!(u32_at(at + 16), lot.id);
        assert_eq!(bytes[at + 20..at + 24], [lot.kind as u8, lot.depth, 0, 0]);
        let size = u64::from_le_bytes(bytes[at + 24..at + 32].try_into().unwrap());
        assert_eq!(size, lot.size);
    }
}

#[test]
fn the_layout_is_deterministic() {
    let tree = tree_of(balanced(&[8, 30], 5));
    assert_eq!(city_layout(&tree, ROOT), city_layout(&tree, ROOT));
}

#[test]
fn kinds_keep_their_wire_numbers() {
    use LotKind::*;
    assert_eq!(
        [District, Block, Building, Annex, Others].map(|k| k as u8),
        [0, 1, 2, 3, 4]
    );
}

#[test]
fn an_empty_root_is_an_empty_field() {
    let empty = tree_of(vec![dir(0, NO_PARENT, "/r", vec![file("zero", 0)])]);
    assert_eq!(city_layout(&empty, ROOT), (400.0, Vec::new()));
}
