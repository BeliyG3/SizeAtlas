use super::*;
use crate::tree::{DirRec, FileRec, NO_PARENT, ScanMeta, SizeMode, sample_tree};

fn files_tree(sizes: &[u64]) -> Tree {
    let files = sizes
        .iter()
        .enumerate()
        .map(|(i, &size)| FileRec {
            name: format!("f{i:04}").into(),
            size,
            len: size,
            mtime: 0,
            flags: 0,
            ino: None,
        })
        .collect();
    Tree::from_records(
        vec![DirRec {
            id: 0,
            parent: NO_PARENT,
            name: "/r".into(),
            mtime: 0,
            flags: 0,
            files,
        }],
        ScanMeta {
            cluster: 0,
            size_mode: SizeMode::Logical,
            scanned_at: 0,
        },
    )
}

fn overlap(a: &Rect, b: &Rect) -> f32 {
    let w = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
    let h = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
    w.max(0.0) * h.max(0.0)
}

fn inside(inner: &Rect, outer: &Rect) -> bool {
    const EPS: f32 = 0.01;
    inner.x >= outer.x - EPS
        && inner.y >= outer.y - EPS
        && inner.x + inner.w <= outer.x + outer.w + EPS
        && inner.y + inner.h <= outer.y + outer.h + EPS
}

#[test]
fn areas_are_proportional_to_sizes_and_inside_the_canvas() {
    let tree = files_tree(&[600, 300, 100]);
    let rects = layout(&tree, 0, 100.0, 100.0, MAX_RECTS);
    assert_eq!(rects.len(), 3);
    let canvas = Rect {
        x: 0.0,
        y: 0.0,
        w: 100.0,
        h: 100.0,
        id: 0,
        category: 0,
        depth: 0,
        is_dir: true,
    };
    for (r, expected) in rects.iter().zip([6000.0, 3000.0, 1000.0]) {
        assert!((r.w * r.h - expected).abs() < 1.0, "{rects:?}");
        assert!(inside(r, &canvas), "{r:?}");
        assert!(!r.is_dir && r.depth == 0);
    }
    for (i, a) in rects.iter().enumerate() {
        for b in &rects[i + 1..] {
            assert!(overlap(a, b) < 0.01, "{a:?} overlaps {b:?}");
        }
    }
}

#[test]
fn folders_contain_their_children_one_level_deeper() {
    let tree = sample_tree();
    let rects = layout(&tree, 0, 400.0, 300.0, MAX_RECTS);
    let docs = rects.iter().find(|r| tree.name(r.id) == "docs").unwrap();
    assert!(docs.is_dir && docs.category == 255 && docs.depth == 0);
    let children: Vec<&Rect> = rects
        .iter()
        .filter(|r| tree.node(r.id).parent == docs.id)
        .collect();
    assert!(!children.is_empty());
    for child in children {
        assert_eq!(child.depth, 1);
        assert!(inside(child, docs), "{child:?} outside {docs:?}");
    }
    assert!(
        rects
            .iter()
            .any(|r| tree.name(r.id) == "d.png" && r.depth == 2)
    );
    // Parents come before their children, so drawing in order paints children on top.
    for (i, r) in rects.iter().enumerate() {
        let parent = tree.node(r.id).parent;
        if let Some(p) = rects.iter().position(|q| q.id == parent) {
            assert!(p < i);
        }
    }
}

#[test]
fn rectangle_budget_is_respected() {
    let tree = files_tree(&vec![1; 1000]);
    assert_eq!(layout(&tree, 0, 1000.0, 1000.0, 50).len(), 50);
    assert_eq!(layout(&tree, 0, 1000.0, 1000.0, MAX_RECTS).len(), 1000);
}

#[test]
fn items_too_small_to_see_are_left_out() {
    let mut sizes = vec![1_000_000];
    sizes.extend(vec![1; 1000]);
    let tree = files_tree(&sizes);
    let rects = layout(&tree, 0, 100.0, 100.0, MAX_RECTS);
    assert_eq!(rects.len(), 1);
    assert!(rects[0].w * rects[0].h > 9_000.0);
}

#[test]
fn file_root_fills_the_canvas_and_degenerate_input_is_empty() {
    let tree = sample_tree();
    let pdf = (0..tree.len() as u32)
        .find(|&id| tree.name(id) == "b.pdf")
        .unwrap();
    let rects = layout(&tree, pdf, 50.0, 20.0, MAX_RECTS);
    assert_eq!(
        (rects.len(), rects[0].w, rects[0].h, rects[0].id),
        (1, 50.0, 20.0, pdf)
    );
    assert!(layout(&tree, 0, 1.0, 300.0, MAX_RECTS).is_empty());
    assert!(layout(&tree, 0, f32::NAN, 300.0, MAX_RECTS).is_empty());
    assert!(layout(&tree, 0, 300.0, 300.0, 0).is_empty());
    assert!(layout(&files_tree(&[0, 0]), 0, 100.0, 100.0, MAX_RECTS).is_empty());
}

#[test]
fn encoding_matches_the_wire_format() {
    let rect = Rect {
        x: 1.5,
        y: 2.0,
        w: 3.0,
        h: 4.0,
        id: 0x0102_0304,
        category: 3,
        depth: 1,
        is_dir: false,
    };
    let bytes = encode(7, 9, true, &[rect]);
    // The same bytes are decoded in src/features/treemap/bytes.test.ts.
    #[rustfmt::skip]
    let expected: [u8; 48] = [
        7, 0, 0, 0, 0, 0, 0, 0,   9, 0, 0, 0, 0, 0, 0, 0,   1, 0, 0, 0,   1, 0, 0, 0,
        0, 0, 0xC0, 0x3F,   0, 0, 0, 0x40,   0, 0, 0x40, 0x40,   0, 0, 0x80, 0x40,
        4, 3, 2, 1,   3, 1, 0, 0,
    ];
    assert_eq!(bytes, expected);
    assert_eq!(bytes.len(), HEADER_LEN + RECORD_LEN);
}

fn city_records(bytes: &[u8]) -> Vec<&[u8]> {
    bytes[HEADER_LEN..].chunks(CITY_RECORD_LEN).collect()
}

fn id_of(record: &[u8]) -> u32 {
    u32::from_le_bytes(record[16..20].try_into().unwrap())
}

#[test]
fn city_encoding_adds_size_and_expanded_at_fixed_offsets() {
    let tree = sample_tree();
    let rects = layout(&tree, 0, CITY_FIELD, CITY_FIELD, MAX_RECTS);
    let bytes = encode_city(7, 9, true, &rects, &tree);
    assert_eq!(
        bytes[..HEADER_LEN],
        encode(7, 9, true, &rects)[..HEADER_LEN]
    );
    assert_eq!(bytes.len(), HEADER_LEN + rects.len() * CITY_RECORD_LEN);
    assert_eq!(rects.len(), 6);
    for (r, rec) in rects.iter().zip(city_records(&bytes)) {
        assert_eq!(f32::from_le_bytes(rec[0..4].try_into().unwrap()), r.x);
        assert_eq!(f32::from_le_bytes(rec[12..16].try_into().unwrap()), r.h);
        assert_eq!(id_of(rec), r.id);
        assert_eq!(rec[20..23], [r.category, r.depth, u8::from(r.is_dir)]);
        let size = u64::from_le_bytes(rec[24..32].try_into().unwrap());
        assert_eq!(size, tree.node(r.id).size);
        // "docs" and "deep" have laid-out children; files never do.
        let name = tree.name(r.id);
        assert_eq!(
            rec[23],
            u8::from(name == "docs" || name == "deep"),
            "{name}"
        );
    }
}

#[test]
fn a_folder_whose_children_are_not_laid_out_is_not_expanded() {
    let file = |name: &str, size| FileRec {
        name: name.into(),
        size,
        len: size,
        mtime: 0,
        flags: 0,
        ino: None,
    };
    let dir = |id, parent, name: &str, files| DirRec {
        id,
        parent,
        name: name.into(),
        mtime: 0,
        flags: 0,
        files,
    };
    // "thin" gets a 3 × 100 strip: drawn, but its inside is narrower than MIN_SIDE.
    let tree = Tree::from_records(
        vec![
            dir(0, NO_PARENT, "/r", vec![file("big", 97)]),
            dir(1, 0, "thin", vec![file("a", 1), file("b", 1), file("c", 1)]),
        ],
        ScanMeta {
            cluster: 0,
            size_mode: SizeMode::Logical,
            scanned_at: 0,
        },
    );
    let rects = layout(&tree, 0, 100.0, 100.0, MAX_RECTS);
    assert_eq!(rects.len(), 2);
    let bytes = encode_city(1, 1, false, &rects, &tree);
    let thin = city_records(&bytes)
        .into_iter()
        .find(|rec| tree.name(id_of(rec)) == "thin")
        .unwrap();
    assert_eq!((thin[22], thin[23]), (1, 0));
}
