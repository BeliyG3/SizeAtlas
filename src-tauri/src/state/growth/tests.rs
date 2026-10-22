use std::collections::HashMap;
use std::sync::Arc;

use sizeatlas_core::baseline::{Baseline, NEW, mark};
use sizeatlas_core::tree::{
    DirRec, FileRec, ListKind, ListOrder, NO_PARENT, ScanMeta, SizeMode, SortKey, Tree,
};

use crate::dto::{ChangeDto, ListDto};
use crate::state::AppState;

const BASE_AT: i64 = 1_699_000_000;

/// A folder below `parent` holding one file of `size`.
fn dir(id: u32, parent: u32, name: &str, size: u64) -> DirRec {
    DirRec {
        id,
        parent,
        name: name.into(),
        mtime: 1,
        flags: 0,
        files: vec![FileRec {
            name: "f".into(),
            size,
            len: size,
            mtime: 1,
            flags: 0,
            ino: None,
        }],
    }
}

/// `/root` with four small files and `dirs` below it.
fn build(dirs: Vec<DirRec>) -> Tree {
    let mut root = dir(0, NO_PARENT, "/root", 1);
    root.files = (0..4)
        .map(|i| FileRec {
            name: format!("r{i}").into(),
            ..root.files[0].clone()
        })
        .collect();
    let mut records = vec![root];
    records.extend(dirs);
    let meta = ScanMeta {
        cluster: 0,
        size_mode: SizeMode::Logical,
        scanned_at: 1_700_000_000,
    };
    Tree::from_records(records, meta)
}

/// Ids of the live children of `parent` by name.
fn ids(tree: &Tree, parent: u32) -> HashMap<String, u32> {
    tree.children(parent)
        .map(|c| (tree.name(c).to_owned(), c))
        .collect()
}

/// Opens `tree` with a baseline where nothing changed, edited by `edit`.
fn open(tree: Tree, edit: impl FnOnce(&Tree, &mut Baseline)) -> (AppState, u64) {
    let mut baseline = Baseline {
        scanned_at: BASE_AT,
        before: (0..tree.len() as u32).map(|i| tree.node(i).size).collect(),
        marks: vec![0; tree.len()],
        deleted: Vec::new(),
    };
    edit(&tree, &mut baseline);
    let rev = tree.rev;
    let state = AppState::default();
    let generation = state.install_tree(tree);
    let installed = state.set_baseline(generation, rev, Some(Arc::new(baseline)));
    assert_eq!(installed, Some(true));
    (state, generation)
}

fn by_change(descending: bool) -> ListOrder {
    ListOrder {
        key: SortKey::Change,
        descending,
        dirs_only: true,
    }
}

fn names(list: &ListDto) -> Vec<&str> {
    list.items.iter().map(|i| i.item.name.as_str()).collect()
}

#[test]
fn children_sorted_by_change() {
    let dirs = ["a", "b", "c", "d", "e"];
    let tree = build((1..).zip(dirs).map(|(id, n)| dir(id, 0, n, 100)).collect());
    let (state, generation) = open(tree, |t, b| {
        let id = ids(t, 0);
        let at = |n: &str| id[n] as usize;
        b.before[at("a")] = 50; // +50, approximate
        b.marks[at("a")] = mark::APPROX;
        b.before[at("b")] = 300; // -200
        b.before[at("c")] = NEW; // new: +100
        b.marks[at("d")] = mark::COVERAGE; // unknown
    });
    let page = |descending, offset, limit| {
        state
            .children(generation, 0, offset, limit, by_change(descending))
            .unwrap()
    };
    let listed = |descending| -> Vec<String> {
        page(descending, 0, 10)
            .items
            .into_iter()
            .map(|i| i.name)
            .collect()
    };
    assert_eq!(listed(true), ["c", "a", "e", "b", "d"]);
    assert_eq!(
        listed(false),
        ["b", "e", "a", "c", "d"],
        "unknown stays last"
    );

    let middle = page(true, 1, 2);
    let rows: Vec<_> = middle
        .items
        .iter()
        .map(|i| (i.name.as_str(), i.before, i.change, i.approx_change))
        .collect();
    assert_eq!(
        rows,
        [
            ("a", Some(50), Some(ChangeDto::Delta(50)), true),
            ("e", Some(100), Some(ChangeDto::Delta(0)), false),
        ]
    );
    assert_eq!((middle.rest_count, middle.rest_size), (2, 200));
    assert_eq!(
        (middle.baseline_at, middle.baseline_rev),
        (Some(BASE_AT), 1)
    );
    let all = page(true, 0, 10);
    assert_eq!(
        (all.items[0].before, all.items[0].change),
        (None, Some(ChangeDto::New))
    );
    assert_eq!(all.items[4].change, Some(ChangeDto::Unknown));

    let id = ids(&state.tree(generation).unwrap(), 0);
    for (descending, name, at) in [(true, "a", 1), (true, "d", 4), (false, "b", 0)] {
        let position = state.position(generation, id[name], by_change(descending));
        assert_eq!(position, Ok(Some(at)), "{name}");
    }
    let summary = state.summary(generation).unwrap();
    assert_eq!(
        (summary.baseline_at, summary.baseline_rev),
        (Some(BASE_AT), 1)
    );
}

#[test]
fn ids_beyond_the_baseline_have_no_change() {
    let (state, generation) = open(build(vec![dir(1, 0, "a", 100)]), |_, _| {});
    let a = ids(&state.tree(generation).unwrap(), 0)["a"];
    // A refresh gives the folder's contents new ids, which the old baseline does not have.
    state
        .change_tree(generation, |tree| {
            tree.replace_subtree(a, vec![dir(0, NO_PARENT, "a", 300)]);
            Some(())
        })
        .unwrap();
    let page = state
        .children(generation, a, 0, 10, ListOrder::DEFAULT)
        .unwrap();
    assert_eq!((page.items[0].before, page.items[0].change), (None, None));
    let list = state.list(generation, 0, ListKind::GrewMost, 10).unwrap();
    assert_eq!(names(&list), ["a"], "the folder kept its id: +200");
}

#[test]
fn grew_most_picks_by_absolute_change() {
    let dirs = (0..1500)
        .map(|i| dir(i + 1, 0, &format!("f{i:04}"), 50_000))
        .collect();
    let (state, generation) = open(build(dirs), |t, b| {
        for (name, id) in ids(t, 0) {
            let Some(i) = name.strip_prefix('f').map(|i| i.parse::<u64>().unwrap()) else {
                continue;
            };
            // Ten large shrinks, below the 1490 growths in a descending order.
            b.before[id as usize] = if i < 10 {
                50_000 + 100_000 + i
            } else {
                50_000 - 1000 - i
            };
        }
    });
    let list = state
        .list(generation, 0, ListKind::GrewMost, u32::MAX)
        .unwrap();
    assert_eq!((list.items.len(), list.truncated), (1000, true));
    let changes: Vec<i64> = list
        .items
        .iter()
        .map(|i| match i.item.change {
            Some(ChangeDto::Delta(d)) => d,
            other => panic!("{other:?}"),
        })
        .collect();
    assert!(changes.is_sorted_by(|a, b| a >= b));
    assert_eq!(names(&list)[0], "f1499");
    let shrinks: Vec<String> = (0..10).map(|i| format!("f{i:04}")).collect();
    assert_eq!(names(&list)[990..], shrinks);
    assert!(list.items.iter().all(|i| i.item.is_dir && !i.deleted));
}

#[test]
fn no_baseline_gives_empty_list() {
    let state = AppState::default();
    let generation = state.install_tree(build(vec![dir(1, 0, "b", 100), dir(2, 0, "a", 50)]));
    let list = state.list(generation, 0, ListKind::GrewMost, 10).unwrap();
    assert!(list.items.is_empty() && !list.truncated);
    assert_eq!((list.baseline_at, list.baseline_rev), (None, 0));

    let page = state
        .children(generation, 0, 0, 10, by_change(true))
        .unwrap();
    let rows: Vec<_> = page
        .items
        .iter()
        .map(|i| (i.name.as_str(), i.before, i.change))
        .collect();
    assert_eq!(rows, [("a", None, None), ("b", None, None)], "by name");
    assert_eq!(page.baseline_at, None);
    assert_eq!(state.summary(generation).unwrap().baseline_at, None);
}

mod deleted;
