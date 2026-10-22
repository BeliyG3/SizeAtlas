//! Deleted folders in the "grew most" list.

use std::sync::Arc;

use sizeatlas_core::baseline::Deleted;
use sizeatlas_core::tree::{ListKind, NO_PARENT};

use super::{BASE_AT, build, dir, ids, open};
use crate::dto::ChangeDto;

#[test]
fn grew_most_lists_topmost_deleted_folder() {
    let tree = build(vec![
        dir(1, 0, "a", 200),
        dir(2, 0, "b", 100),
        dir(3, 1, "a1", 300),
    ]);
    let (a, b) = (ids(&tree, 0)["a"], ids(&tree, 0)["b"]);
    let deleted = |parent, name: &str, size| Deleted {
        parent,
        name: name.into(),
        size,
    };
    let (state, generation) = open(tree, |_, base| {
        base.deleted = vec![deleted(a, "old", 5000), deleted(b, "gone", 7000)];
    });
    let rows = |base| {
        let list = state
            .list(generation, base, ListKind::GrewMost, 10)
            .unwrap();
        assert_eq!(list.baseline_at, Some(BASE_AT));
        list.items
            .into_iter()
            .map(|i| (i.item.name, i.folder, i.item.change))
            .collect::<Vec<_>>()
    };
    let row = |name: &str, folder: &str, delta| {
        (name.into(), folder.into(), Some(ChangeDto::Delta(delta)))
    };

    let below_a = state.list(generation, a, ListKind::GrewMost, 10).unwrap();
    let old = &below_a.items[0];
    assert_eq!(below_a.items.len(), 1);
    assert!(old.deleted && old.item.is_dir);
    assert_eq!((old.item.id, old.parent, old.item.size), (u32::MAX, a, 0));
    assert_eq!(old.item.before, Some(5000));
    assert_eq!(rows(0), [row("old", "a", -5000), row("gone", "b", -7000)]);

    // Moved to the trash while the baseline stays: `a` is deleted, not `a1` or `old` inside it.
    state
        .change_tree(generation, |tree| {
            tree.remove(a);
            Some(())
        })
        .unwrap();
    assert_eq!(rows(0), [row("a", "", -500), row("gone", "b", -7000)]);
    let ids: Vec<u32> = state
        .list(generation, 0, ListKind::GrewMost, 10)
        .unwrap()
        .items
        .iter()
        .map(|i| i.item.id)
        .collect();
    assert_eq!(ids, [u32::MAX, u32::MAX - 1]);

    // A baseline that already lists `a` as deleted does not list it twice.
    let mut again = (*state.baseline(generation).unwrap()).clone();
    again.deleted.push(deleted(0, "a", 500));
    let rev = state.tree(generation).unwrap().rev;
    state.set_baseline(generation, rev, Some(Arc::new(again)));
    assert_eq!(rows(0), [row("a", "", -500), row("gone", "b", -7000)]);
}

#[test]
fn folders_found_again_by_a_refresh_are_not_deleted() {
    let tree = build(vec![
        dir(1, 0, "a", 100),
        dir(2, 1, "kept", 200),
        dir(3, 1, "vanished", 300),
    ]);
    let a = ids(&tree, 0)["a"];
    let (state, generation) = open(tree, |_, base| {
        // Deleted before the last scan, created again since.
        base.deleted = vec![Deleted {
            parent: a,
            name: "back".into(),
            size: 50,
        }];
    });
    // The refresh kills a's old subtree and finds `kept` and `back`; the old baseline stays.
    let records = vec![
        dir(0, NO_PARENT, "a", 100),
        dir(1, 0, "kept", 200),
        dir(2, 0, "back", 50),
    ];
    state
        .change_tree(generation, |tree| {
            tree.replace_subtree(a, records);
            Some(())
        })
        .unwrap();
    let list = state.list(generation, 0, ListKind::GrewMost, 10).unwrap();
    let deleted: Vec<&str> = list
        .items
        .iter()
        .filter(|i| i.deleted)
        .map(|i| i.item.name.as_str())
        .collect();
    assert_eq!(deleted, ["vanished"]);
}
