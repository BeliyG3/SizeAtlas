use crate::tree::{
    DirRec, FileRec, ListOrder, NO_PARENT, ScanMeta, SizeMode, SortKey, Tree, VolumeUsage, flags,
    sample_tree,
};

fn tree_with_files(sizes: &[(&str, u64)]) -> Tree {
    let files = sizes
        .iter()
        .map(|(name, size)| FileRec {
            name: (*name).into(),
            size: *size,
            len: *size,
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

fn names(tree: &Tree, ids: &[u32]) -> Vec<String> {
    ids.iter().map(|&id| tree.name(id).to_owned()).collect()
}

#[test]
fn get_rejects_out_of_range_and_dead_nodes() {
    let mut tree = sample_tree();
    assert!(tree.get(0).is_some());
    assert!(tree.get(tree.len() as u32).is_none());
    let last = tree.len() - 1;
    tree.nodes_mut_for_test()[last].flags &= !flags::ALIVE;
    assert!(tree.get(last as u32).is_none());
}

#[test]
fn children_page_sorts_by_size_then_name() {
    let tree = tree_with_files(&[("b", 5), ("a", 5), ("c", 9), ("d", 1)]);
    let page = tree.children_page(0, 0, 10, ListOrder::DEFAULT);
    assert_eq!(names(&tree, &page.items), ["c", "a", "b", "d"]);
    assert_eq!((page.total, page.rest_count, page.rest_size), (4, 0, 0));
}

#[test]
fn pages_cover_every_child_exactly_once() {
    let files: Vec<(String, u64)> = (0..1_000)
        .map(|i| (format!("f{i:04}"), (i % 37) as u64))
        .collect();
    let refs: Vec<(&str, u64)> = files.iter().map(|(n, s)| (n.as_str(), *s)).collect();
    let tree = tree_with_files(&refs);
    let mut seen = Vec::new();
    let mut offset = 0;
    loop {
        let page = tree.children_page(0, offset, 200, ListOrder::DEFAULT);
        if page.items.is_empty() {
            break;
        }
        let rest_size: u64 = seen
            .iter()
            .chain(&page.items)
            .map(|&id| tree.node(id).size)
            .sum();
        assert_eq!(page.rest_size, tree.node(0).size - rest_size);
        offset += page.items.len() as u32;
        seen.extend(page.items);
    }
    seen.sort_unstable();
    seen.dedup();
    assert_eq!(seen.len(), 1_000);
}

#[test]
fn page_past_the_end_is_empty() {
    let tree = tree_with_files(&[("a", 1)]);
    let page = tree.children_page(0, 5, 200, ListOrder::DEFAULT);
    assert!(page.items.is_empty());
    assert_eq!((page.total, page.rest_count, page.rest_size), (1, 0, 0));
}

#[test]
fn crumbs_go_from_root_to_node() {
    let tree = sample_tree();
    let docs = tree.children(0).find(|&c| tree.name(c) == "docs").unwrap();
    let deep = tree
        .children(docs)
        .find(|&c| tree.name(c) == "deep")
        .unwrap();
    assert_eq!(tree.crumbs(deep), vec![0, docs, deep]);
    assert_eq!(tree.crumbs(0), vec![0]);
}

#[test]
fn lossy_ancestor_makes_the_path_inexact() {
    let mut tree = sample_tree();
    let docs = tree.children(0).find(|&c| tree.name(c) == "docs").unwrap();
    let deep = tree
        .children(docs)
        .find(|&c| tree.name(c) == "deep")
        .unwrap();
    assert!(!tree.has_lossy_path(deep));
    tree.nodes_mut_for_test()[docs as usize].flags |= flags::LOSSY_NAME;
    assert!(tree.has_lossy_path(deep));
}

#[test]
fn check_structure_rejects_bad_categories() {
    let mut tree = sample_tree();
    let file = tree.children(0).find(|&c| !tree.node(c).is_dir()).unwrap();
    tree.nodes_mut_for_test()[file as usize].category = 200;
    assert!(tree.check_structure().is_err());
    let mut tree = sample_tree();
    tree.nodes_mut_for_test()[0].category = 3;
    assert!(tree.check_structure().is_err());
}

#[test]
fn unaccounted_is_used_space_minus_scanned_size_never_negative() {
    let mut tree = sample_tree(); // root size 572
    assert_eq!(tree.unaccounted(), None);
    tree.volume = Some(VolumeUsage {
        total: 10_000,
        used: 1_000,
    });
    assert_eq!(tree.unaccounted(), Some(428));
    tree.volume = Some(VolumeUsage {
        total: 10_000,
        used: 100,
    });
    assert_eq!(tree.unaccounted(), Some(0));
}

/// Root: files "b.txt" (size 10, len 3, mtime 30), "A.txt" (10, 9, 10), "c.txt" (40, 1, 20);
/// folder "d1" (mtime 5: files x, y of 1 byte and an empty folder "e");
/// folder "D2" (mtime 40: file z of 5 bytes).
fn mixed_tree() -> Tree {
    let f = |name: &str, size: u64, len: u64, mtime: i64| FileRec {
        name: name.into(),
        size,
        len,
        mtime,
        flags: 0,
        ino: None,
    };
    let d = |id: u32, parent: u32, name: &str, mtime: i64, files: Vec<FileRec>| DirRec {
        id,
        parent,
        name: name.into(),
        mtime,
        flags: 0,
        files,
    };
    Tree::from_records(
        vec![
            d(
                0,
                NO_PARENT,
                "/r",
                0,
                vec![
                    f("b.txt", 10, 3, 30),
                    f("A.txt", 10, 9, 10),
                    f("c.txt", 40, 1, 20),
                ],
            ),
            d(1, 0, "d1", 5, vec![f("x", 1, 1, 0), f("y", 1, 1, 0)]),
            d(2, 1, "e", 0, vec![]),
            d(3, 0, "D2", 40, vec![f("z", 5, 5, 0)]),
        ],
        ScanMeta {
            cluster: 0,
            size_mode: SizeMode::Logical,
            scanned_at: 0,
        },
    )
}

fn order(key: SortKey, descending: bool) -> ListOrder {
    ListOrder {
        key,
        descending,
        dirs_only: false,
    }
}

fn listing(tree: &Tree, order: ListOrder) -> Vec<String> {
    names(tree, &tree.children_page(0, 0, 100, order).items)
}

fn child_named(tree: &Tree, parent: u32, name: &str) -> u32 {
    tree.children(parent)
        .find(|&c| tree.name(c) == name)
        .unwrap()
}

#[test]
fn every_sort_key_orders_and_breaks_ties_by_name_then_id() {
    let tree = mixed_tree();
    let cases = [
        (
            ListOrder::DEFAULT,
            vec!["c.txt", "A.txt", "b.txt", "D2", "d1"],
        ),
        (
            order(SortKey::Name, false),
            vec!["A.txt", "b.txt", "c.txt", "d1", "D2"],
        ),
        (
            order(SortKey::Name, true),
            vec!["D2", "d1", "c.txt", "b.txt", "A.txt"],
        ),
        (
            order(SortKey::Len, true),
            vec!["A.txt", "D2", "b.txt", "d1", "c.txt"],
        ),
        (
            order(SortKey::Files, true),
            vec!["d1", "A.txt", "D2", "b.txt", "c.txt"],
        ),
        (
            order(SortKey::Dirs, true),
            vec!["d1", "A.txt", "D2", "b.txt", "c.txt"],
        ),
        (
            order(SortKey::Modified, false),
            vec!["d1", "A.txt", "c.txt", "b.txt", "D2"],
        ),
        (ListOrder::FOLDERS, vec!["d1", "D2"]),
    ];
    for (order, expected) in cases {
        assert_eq!(listing(&tree, order), expected, "{order:?}");
    }
}

#[test]
fn position_matches_the_listing_for_every_order() {
    let tree = mixed_tree();
    let keys = [
        SortKey::Name,
        SortKey::Size,
        SortKey::Len,
        SortKey::Files,
        SortKey::Dirs,
        SortKey::Modified,
    ];
    for key in keys {
        for descending in [false, true] {
            for dirs_only in [false, true] {
                let order = ListOrder {
                    key,
                    descending,
                    dirs_only,
                };
                let page = tree.children_page(0, 0, 100, order);
                for (pos, &id) in page.items.iter().enumerate() {
                    assert_eq!(
                        tree.position(id, order),
                        Some(pos as u32),
                        "{order:?} {}",
                        tree.name(id)
                    );
                }
            }
        }
    }
    assert_eq!(tree.position(0, ListOrder::DEFAULT), None);
    let c = child_named(&tree, 0, "c.txt");
    assert_eq!(tree.position(c, ListOrder::FOLDERS), None);
}

#[test]
fn rank_counts_sibling_folders_in_tree_order() {
    let tree = mixed_tree();
    let d1 = child_named(&tree, 0, "d1");
    let d2 = child_named(&tree, 0, "D2");
    let e = child_named(&tree, d1, "e");
    assert_eq!(
        (tree.rank(0), tree.rank(d1), tree.rank(d2), tree.rank(e)),
        (0, 0, 1, 0)
    );
    // A file counts the sibling folders whose names come before its own.
    assert_eq!(tree.rank(child_named(&tree, 0, "c.txt")), 0);
}

#[test]
fn rank_orders_sibling_folders_by_name_ignoring_size_and_files() {
    let d = |id: u32, name: &str, files: Vec<FileRec>| DirRec {
        id,
        parent: if id == 0 { NO_PARENT } else { 0 },
        name: name.into(),
        mtime: 0,
        flags: 0,
        files,
    };
    let big = FileRec {
        name: "big".into(),
        size: 1_000,
        len: 1_000,
        mtime: 0,
        flags: 0,
        ino: None,
    };
    let file = FileRec {
        name: "0.txt".into(),
        ..big.clone()
    };
    let tree = Tree::from_records(
        vec![
            d(0, "/r", vec![file]),
            d(1, "b", vec![big]),
            d(2, "A", vec![]),
            d(3, "c", vec![]),
        ],
        ScanMeta {
            cluster: 0,
            size_mode: SizeMode::Logical,
            scanned_at: 0,
        },
    );
    let ranks: Vec<u32> = ["b", "A", "c"]
        .iter()
        .map(|n| tree.rank(child_named(&tree, 0, n)))
        .collect();
    assert_eq!(ranks, [1, 0, 2]);
    assert_eq!(listing(&tree, ListOrder::FOLDERS), ["A", "b", "c"]);
}

#[test]
fn rank_in_follows_the_requested_order() {
    let d = |id: u32, name: &str, size: u64| DirRec {
        id,
        parent: if id == 0 { NO_PARENT } else { 0 },
        name: name.into(),
        mtime: 0,
        flags: 0,
        files: vec![FileRec {
            name: "f".into(),
            size,
            len: size,
            mtime: 0,
            flags: 0,
            ino: None,
        }],
    };
    let tree = Tree::from_records(
        vec![d(0, "/r", 1), d(1, "b", 30), d(2, "A", 10), d(3, "c", 20)],
        ScanMeta {
            cluster: 0,
            size_mode: SizeMode::Logical,
            scanned_at: 0,
        },
    );
    // The root holds a file "f" of size 1 that a folders-only order must not count.
    let order = |key, descending| ListOrder {
        key,
        descending,
        dirs_only: true,
    };
    let ranks = |order: ListOrder| -> Vec<u32> {
        ["A", "b", "c"]
            .iter()
            .map(|n| tree.rank_in(child_named(&tree, 0, n), order))
            .collect()
    };
    assert_eq!(ranks(order(SortKey::Name, false)), [0, 1, 2]);
    assert_eq!(ranks(order(SortKey::Name, true)), [2, 1, 0]);
    // Sizes: A 10, c 20, b 30.
    assert_eq!(ranks(order(SortKey::Size, false)), [0, 2, 1]);
    assert_eq!(ranks(order(SortKey::Size, true)), [2, 0, 1]);
    assert_eq!(tree.rank_in(0, order(SortKey::Size, true)), 0);
    assert_eq!(ranks(ListOrder::FOLDERS), [0, 1, 2]);
}

#[test]
fn direct_dirs_and_listings_skip_dead_nodes() {
    let mut tree = mixed_tree();
    let d1 = child_named(&tree, 0, "d1");
    let d2 = child_named(&tree, 0, "D2");
    let c = child_named(&tree, 0, "c.txt");
    assert_eq!(
        (
            tree.direct_dirs(0),
            tree.direct_dirs(d1),
            tree.direct_dirs(c)
        ),
        (2, 1, 0)
    );
    tree.nodes_mut_for_test()[d2 as usize].flags &= !flags::ALIVE;
    assert_eq!(tree.direct_dirs(0), 1);
    assert_eq!(listing(&tree, ListOrder::FOLDERS), ["d1"]);
    assert_eq!(tree.position(d1, ListOrder::FOLDERS), Some(0));
    assert_eq!(tree.rank(d1), 0);
}

#[test]
fn huge_folder_pages_and_positions_agree() {
    let files: Vec<(String, u64)> = (0..300_000u64)
        .map(|i| (format!("f{i:06}"), i * 7_919 % 1_000))
        .collect();
    let refs: Vec<(&str, u64)> = files.iter().map(|(n, s)| (n.as_str(), *s)).collect();
    let tree = tree_with_files(&refs);
    let order = order(SortKey::Len, false);
    let last = tree.children_page(0, 299_800, 200, order);
    assert_eq!((last.items.len(), last.rest_count), (200, 0));
    assert_eq!(tree.position(last.items[199], order), Some(299_999));
    let middle = tree.children_page(0, 150_000, 1, order).items[0];
    assert_eq!(tree.position(middle, order), Some(150_000));
}
