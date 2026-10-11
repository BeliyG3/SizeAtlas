use std::ffi::OsString;

use super::*;

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

fn meta() -> ScanMeta {
    ScanMeta {
        cluster: 0,
        size_mode: SizeMode::Logical,
        scanned_at: 0,
    }
}

fn names(tree: &Tree, id: u32) -> Vec<&str> {
    tree.children(id).map(|c| tree.name(c)).collect()
}

fn child(tree: &Tree, id: u32, name: &str) -> u32 {
    tree.children(id)
        .find(|&c| tree.name(c) == name)
        .expect("child exists")
}

#[test]
fn children_of_each_directory_form_one_block() {
    // root -> {A -> x, B}: depth-first layout would give root, A, x, B.
    let recs = vec![
        dir(0, NO_PARENT, "/r", vec![]),
        dir(1, 0, "A", vec![file("x", 1)]),
        dir(2, 0, "B", vec![]),
    ];
    let tree = Tree::from_records(recs, meta());
    tree.assert_invariants();
    assert_eq!(names(&tree, 0), ["A", "B"]);
    let a = child(&tree, 0, "A");
    assert_eq!(names(&tree, a), ["x"]);
    assert_eq!((tree.node(0).first_child, tree.node(0).child_count), (1, 2));
}

#[test]
fn files_and_directories_share_one_sorted_block() {
    let recs = vec![
        dir(0, NO_PARENT, "/r", vec![file("c", 1), file("a", 1)]),
        dir(1, 0, "b", vec![]),
    ];
    let tree = Tree::from_records(recs, meta());
    assert_eq!(names(&tree, 0), ["a", "b", "c"]);
    assert!(tree.node(child(&tree, 0, "b")).is_dir());
}

#[test]
fn totals_are_summed_bottom_up() {
    let recs = vec![
        dir(0, NO_PARENT, "/r", vec![file("f", 1)]),
        dir(1, 0, "A", vec![file("x", 10), file("y", 20)]),
        dir(2, 1, "B", vec![file("z", 100)]),
    ];
    let tree = Tree::from_records(recs, meta());
    tree.assert_invariants();
    assert_eq!((tree.node(0).size, tree.node(0).files), (131, 4));
    let a = child(&tree, 0, "A");
    assert_eq!((tree.node(a).size, tree.node(a).files), (130, 3));
    assert_eq!(tree.live as usize, tree.len());
}

#[test]
fn record_order_does_not_matter() {
    let recs = vec![
        dir(0, NO_PARENT, "/r", vec![file("f", 1)]),
        dir(1, 0, "A", vec![file("x", 2)]),
        dir(2, 1, "B", vec![file("y", 3)]),
        dir(3, 0, "C", vec![]),
    ];
    let mut reversed = recs.clone();
    reversed.reverse();
    assert_eq!(
        Tree::from_records(recs, meta()),
        Tree::from_records(reversed, meta())
    );
}

#[test]
fn deep_chain_does_not_overflow_the_stack() {
    let mut recs = vec![dir(0, NO_PARENT, "/r", vec![])];
    for id in 1..10_000u32 {
        recs.push(dir(id, id - 1, "d", vec![file("f", 1)]));
    }
    let tree = Tree::from_records(recs, meta());
    assert_eq!(tree.node(0).files, 9_999);
    tree.assert_invariants();
    drop(tree);
}

#[test]
fn huge_flat_directory_keeps_one_block() {
    let files = (0..200_000).map(|i| file(&format!("f{i:06}"), 1)).collect();
    let tree = Tree::from_records(vec![dir(0, NO_PARENT, "/r", files)], meta());
    assert_eq!(tree.node(0).child_count, 200_000);
    assert_eq!((tree.node(0).size, tree.node(0).files), (200_000, 200_000));
    tree.assert_invariants();
}

struct Lcg(u64);

impl Lcg {
    fn below(&mut self, bound: u32) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        ((self.0 >> 33) % u64::from(bound)) as u32
    }
}

#[test]
fn random_trees_keep_invariants_and_totals() {
    for seed in 0..50u64 {
        let mut rng = Lcg(seed);
        let dirs = 1 + rng.below(40);
        let (mut total, mut count) = (0u64, 0u32);
        let mut recs = Vec::new();
        for id in 0..dirs {
            let parent = if id == 0 { NO_PARENT } else { rng.below(id) };
            let files = (0..rng.below(4))
                .map(|k| {
                    let size = u64::from(rng.below(1000));
                    total += size;
                    count += 1;
                    file(&format!("f{id}_{k}"), size)
                })
                .collect();
            recs.push(dir(id, parent, &format!("d{id}"), files));
        }
        let tree = Tree::from_records(recs, meta());
        tree.assert_invariants();
        assert_eq!(
            (tree.node(0).size, tree.node(0).files),
            (total, count),
            "seed {seed}"
        );
        assert_eq!(tree.len(), dirs as usize + count as usize);
    }
}

#[test]
fn hardlinks_are_counted_once_in_breadth_first_order() {
    let link = |name: &str| FileRec {
        ino: Some((1, 42)),
        ..file(name, 100)
    };
    let recs = vec![
        dir(0, NO_PARENT, "/r", vec![]),
        dir(1, 0, "y", vec![link("f")]),
        dir(2, 0, "x", vec![link("f")]),
    ];
    let tree = Tree::from_records(recs, meta());
    let in_x = child(&tree, child(&tree, 0, "x"), "f");
    let in_y = child(&tree, child(&tree, 0, "y"), "f");
    assert_eq!((tree.node(in_x).size, tree.node(in_y).size), (100, 0));
    assert!(tree.node(in_x).has(flags::HARDLINK) && tree.node(in_y).has(flags::HARDLINK));
    assert_eq!(tree.node(0).size, 100);
}

#[test]
fn unreadable_and_cloud_directories_stay_in_the_tree() {
    let mut locked = dir(1, 0, "locked", vec![]);
    locked.flags = flags::IS_DIR | flags::ACCESS_ERROR;
    let mut cloud = dir(2, 0, "OneDrive", vec![]);
    cloud.flags = flags::IS_DIR | flags::CLOUD;
    let tree = Tree::from_records(vec![dir(0, NO_PARENT, "/r", vec![]), locked, cloud], meta());
    assert_eq!(names(&tree, 0), ["OneDrive", "locked"]);
    assert!(
        tree.node(child(&tree, 0, "locked"))
            .has(flags::ACCESS_ERROR)
    );
    assert!(tree.node(child(&tree, 0, "OneDrive")).has(flags::CLOUD));
    assert_eq!(tree.access_errors, 1);
}

#[cfg(unix)]
fn invalid_name() -> OsString {
    use std::os::unix::ffi::OsStringExt;
    OsString::from_vec(vec![b'b', 0xFF, b'd'])
}

#[cfg(windows)]
fn invalid_name() -> OsString {
    use std::os::windows::ffi::OsStringExt;
    OsString::from_wide(&[u16::from(b'b'), 0xD800, u16::from(b'd')])
}

#[test]
fn invalid_unicode_names_are_kept_lossy_and_flagged() {
    let bad = FileRec {
        name: invalid_name(),
        ..file("", 5)
    };
    let tree = Tree::from_records(vec![dir(0, NO_PARENT, "/r", vec![bad])], meta());
    let id = tree.children(0).next().unwrap();
    assert!(tree.node(id).has(flags::LOSSY_NAME));
    assert!(tree.name(id).contains('\u{FFFD}'));
    assert_eq!(tree.node(0).size, 5);
}

#[test]
fn path_joins_root_path_and_names() {
    let tree = Tree::from_records(
        vec![
            dir(0, NO_PARENT, "/r", vec![]),
            dir(1, 0, "A", vec![file("x.txt", 1)]),
        ],
        meta(),
    );
    let x = child(&tree, child(&tree, 0, "A"), "x.txt");
    assert_eq!(
        tree.path(x),
        std::path::Path::new("/r").join("A").join("x.txt")
    );
}

#[test]
fn compact_snapshot_of_a_fresh_tree_is_identical() {
    let tree = sample_tree();
    assert_eq!(tree.compact_snapshot(), tree);
}

#[test]
fn check_structure_rejects_broken_indices() {
    let mut tree = sample_tree();
    tree.nodes[0].child_count = 1_000;
    assert!(tree.check_structure().is_err());
    let mut tree = sample_tree();
    let last = tree.len() - 1;
    tree.nodes[last].parent = 999_999;
    assert!(tree.check_structure().is_err());
}

/// Marks `id` dead without touching any other field.
fn kill(tree: &mut Tree, id: u32) {
    tree.nodes[id as usize].flags &= !flags::ALIVE;
    tree.live -= 1;
    tree.dead += 1;
}

#[test]
fn check_structure_rejects_a_file_with_children() {
    let mut tree = sample_tree();
    let a = child(&tree, 0, "a.mp4") as usize;
    tree.nodes[a].child_count = 1;
    assert!(tree.check_structure().is_err());
}

#[test]
fn check_structure_rejects_a_file_block_that_would_overflow() {
    let mut tree = sample_tree();
    let a = child(&tree, 0, "a.mp4") as usize;
    tree.nodes[a].first_child = u32::MAX;
    tree.nodes[a].child_count = 1;
    assert!(tree.check_structure().is_err());
}

#[test]
fn check_structure_rejects_a_block_holding_foreign_nodes() {
    let mut tree = sample_tree();
    let docs = child(&tree, 0, "docs") as usize;
    tree.nodes[docs].first_child = 0;
    tree.nodes[docs].child_count = tree.len() as u32;
    assert!(tree.check_structure().is_err());
}

#[test]
fn check_structure_rejects_overlapping_blocks() {
    let mut tree = sample_tree();
    let docs = child(&tree, 0, "docs") as usize;
    tree.nodes[docs].first_child = tree.nodes[0].first_child;
    assert!(tree.check_structure().is_err());
}

#[test]
fn check_structure_rejects_dead_nodes_with_bad_parents() {
    for parent in [None, Some(999_999)] {
        let mut tree = sample_tree();
        let last = tree.len() as u32 - 1;
        kill(&mut tree, last);
        tree.nodes[last as usize].parent = parent.unwrap_or(last);
        assert!(tree.check_structure().is_err(), "parent {parent:?}");
    }
}

#[test]
fn check_structure_rejects_inconsistent_counters() {
    let mut tree = sample_tree();
    tree.live = u32::MAX;
    assert!(tree.check_structure().is_err());
    let mut tree = sample_tree();
    tree.dead += 1;
    assert!(tree.check_structure().is_err());
    let mut tree = sample_tree();
    tree.live -= 1;
    tree.dead += 1;
    assert!(tree.check_structure().is_err());
}

#[test]
fn compact_snapshot_drops_dead_subtrees() {
    let mut tree = sample_tree();
    let docs = child(&tree, 0, "docs");
    let mut doomed = vec![docs];
    let mut next = 0;
    while next < doomed.len() {
        let id = doomed[next];
        doomed.extend(tree.children(id));
        next += 1;
    }
    let d = tree.node(docs);
    let (size, files, len, dirs) = (d.size, d.files, d.len, d.dirs + 1);
    for &id in &doomed {
        kill(&mut tree, id);
    }
    tree.nodes[0].size -= size;
    tree.nodes[0].files -= files;
    tree.nodes[0].len -= len;
    tree.nodes[0].dirs -= dirs;
    tree.check_structure().unwrap();

    let snapshot = tree.compact_snapshot();
    snapshot.check_structure().unwrap();
    snapshot.assert_invariants();
    assert_eq!((snapshot.len(), snapshot.live, snapshot.dead), (2, 2, 0));
    assert_eq!(names(&snapshot, 0), ["a.mp4"]);
}

#[test]
fn logical_length_and_folder_count_are_summed() {
    let recs = vec![
        dir(
            0,
            NO_PARENT,
            "/r",
            vec![FileRec {
                len: 7,
                ..file("f", 4096)
            }],
        ),
        dir(
            1,
            0,
            "A",
            vec![FileRec {
                len: 3,
                ..file("x", 4096)
            }],
        ),
        dir(2, 1, "B", vec![]),
        dir(3, 0, "C", vec![]),
    ];
    let tree = Tree::from_records(recs, meta());
    tree.assert_invariants();
    assert_eq!((tree.node(0).len, tree.node(0).dirs), (10, 3));
    let a = child(&tree, 0, "A");
    assert_eq!((tree.node(a).len, tree.node(a).dirs), (3, 1));
    let f = child(&tree, 0, "f");
    assert_eq!(
        (tree.node(f).len, tree.node(f).size, tree.node(f).dirs),
        (7, 4096, 0)
    );
}
