use std::fs;
use std::path::Path;
use std::sync::atomic::AtomicBool;

use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};
use sizeatlas_core::tree::SortKey;
use sizeatlas_core::treemap;
use tempfile::TempDir;

use super::*;
use crate::dto::ChildrenDto;

fn scan_dir(path: &Path) -> Tree {
    let ScanOutcome::Done(tree) =
        scan(path, &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    tree
}

fn scanned_tree() -> (TempDir, Tree) {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub").join("big.bin"), vec![0u8; 10_000]).unwrap();
    fs::write(dir.path().join("small.txt"), b"x").unwrap();
    let tree = scan_dir(dir.path());
    (dir, tree)
}

fn open_roots(state: &AppState) -> Vec<String> {
    state.summaries().into_iter().map(|s| s.root).collect()
}

#[test]
fn an_unknown_generation_is_stale() {
    assert_eq!(AppState::default().summary(1), Err(CmdError::StaleId));
}

#[test]
fn installing_the_same_root_again_replaces_it() {
    let state = AppState::default();
    let (_dir, tree) = scanned_tree();
    let first = state.install_tree(tree.clone());
    let second = state.install_tree(tree);
    assert_eq!(second, first + 1);
    assert_eq!(state.summaries().len(), 1);
    assert_eq!(state.summary(second).unwrap().generation, second);
    assert_eq!(state.summary(first), Err(CmdError::StaleId));
}

#[test]
fn roots_keep_their_order_when_one_is_replaced_or_closed() {
    let dirs: Vec<TempDir> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
    let state = AppState::default();
    let generations: Vec<u64> = dirs
        .iter()
        .map(|d| state.install_tree(scan_dir(d.path())))
        .collect();
    let names = open_roots(&state);
    let rescanned = state.install_tree(scan_dir(dirs[1].path()));
    assert_eq!(open_roots(&state), names, "a rescan keeps the root's place");
    assert!(rescanned > generations[2]);
    assert_eq!(
        state.children(generations[1], 0, 0, 10, ListOrder::DEFAULT),
        Err(CmdError::StaleId)
    );
    assert!(state.summary(generations[0]).is_ok() && state.summary(generations[2]).is_ok());
    assert!(state.close_path(&names[0]));
    assert!(!state.close_path(&names[0]), "closed already");
    assert_eq!(open_roots(&state), names[1..].to_vec());
    assert!(state.close_path(&names[2]));
    assert_eq!(open_roots(&state), names[1..2].to_vec());
}

#[test]
fn generations_are_never_reused() {
    let state = AppState::default();
    let (_dir, tree) = scanned_tree();
    let first = state.install_tree(tree.clone());
    assert!(state.close_path(tree.name(0)));
    let again = state.install_tree(tree);
    assert!(again > first);
    assert_eq!(state.summary(first), Err(CmdError::StaleId));
}

#[test]
fn children_are_sorted_and_described() {
    let state = AppState::default();
    let (_dir, tree) = scanned_tree();
    let generation = state.install_tree(tree);
    let page = state
        .children(generation, 0, 0, 200, ListOrder::DEFAULT)
        .unwrap();
    let names: Vec<_> = page.items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(names, ["sub", "small.txt"]);
    let sub = &page.items[0];
    assert!(sub.is_dir);
    assert_eq!(
        (sub.files, sub.folders, sub.dirs, sub.len),
        (1, 0, 0, 10_000)
    );
    assert_eq!(page.size, state.summary(generation).unwrap().total);
    assert_eq!((page.total, page.rest_count), (2, 0));
}

#[test]
fn wrong_generation_or_id_is_stale() {
    let state = AppState::default();
    let (_dir, tree) = scanned_tree();
    let generation = state.install_tree(tree);
    assert_eq!(
        state.children(generation + 1, 0, 0, 10, ListOrder::DEFAULT),
        Err(CmdError::StaleId)
    );
    assert_eq!(
        state.crumbs(generation, 9_999, None),
        Err(CmdError::StaleId)
    );
    assert!(state.close_path(&state.summary(generation).unwrap().root));
    assert_eq!(
        state.children(generation, 0, 0, 10, ListOrder::DEFAULT),
        Err(CmdError::StaleId)
    );
}

#[test]
fn crumbs_and_exact_path() {
    let state = AppState::default();
    let (dir, tree) = scanned_tree();
    let generation = state.install_tree(tree);
    let sub = state
        .children(generation, 0, 0, 10, ListOrder::DEFAULT)
        .unwrap()
        .items[0]
        .id;
    let crumbs = state.crumbs(generation, sub, None).unwrap();
    assert_eq!(
        crumbs.iter().map(|c| c.id).collect::<Vec<_>>(),
        vec![0, sub]
    );
    let canonical = dunce::canonicalize(dir.path()).unwrap();
    assert_eq!(
        state.exact_path(generation, sub).unwrap(),
        canonical.join("sub")
    );
}

#[test]
fn lossy_names_have_no_exact_path() {
    let state = AppState::default();
    let (_dir, mut tree) = scanned_tree();
    let sub = tree.children(0).find(|&c| tree.node(c).is_dir()).unwrap();
    tree.mark_lossy_for_test(sub);
    let generation = state.install_tree(tree);
    assert_eq!(state.exact_path(generation, sub), Err(CmdError::LossyName));
}

#[test]
fn panels_and_treemap_describe_the_subtree() {
    let state = AppState::default();
    let (_dir, tree) = scanned_tree();
    let generation = state.install_tree(tree);
    let stats = state.type_stats(generation, 0).unwrap();
    assert_eq!(stats.items.iter().map(|s| s.files).sum::<u64>(), 2);
    assert!(stats.items.windows(2).all(|w| w[0].size >= w[1].size));
    let bytes = state.treemap(generation, 0, 200.0, 100.0).unwrap();
    assert_eq!(
        u64::from_le_bytes(bytes[..8].try_into().unwrap()),
        generation
    );
    let count = u32::from_le_bytes(bytes[16..20].try_into().unwrap()) as usize;
    assert!(count > 0);
    assert_eq!(
        bytes.len(),
        treemap::HEADER_LEN + treemap::RECORD_LEN * count
    );
    let empty = state.treemap(generation, 0, f32::NAN, 100.0).unwrap();
    assert_eq!(empty.len(), treemap::HEADER_LEN);
    assert_eq!(state.type_stats(generation + 1, 0), Err(CmdError::StaleId));
}

#[test]
fn crumbs_carry_size_and_rank() {
    let state = AppState::default();
    let (_dir, tree) = scanned_tree();
    let generation = state.install_tree(tree);
    let page = state
        .children(generation, 0, 0, 10, ListOrder::DEFAULT)
        .unwrap();
    let small = page.items[1].id;
    let crumbs = state.crumbs(generation, small, None).unwrap();
    assert_eq!(crumbs.len(), 2);
    // The tree lists folders by name: no sibling folder comes before "small.txt".
    assert_eq!((crumbs[0].rank, crumbs[1].rank), (0, 0));
    assert_eq!(crumbs[1].size, page.items[1].size);
    assert_eq!(crumbs[0].size, state.summary(generation).unwrap().total);
}

#[test]
fn crumb_ranks_follow_the_tree_order() {
    let dir = tempfile::tempdir().unwrap();
    for (name, bytes) in [("a", 1usize), ("b", 50_000)] {
        fs::create_dir(dir.path().join(name)).unwrap();
        fs::write(dir.path().join(name).join("f.bin"), vec![0u8; bytes]).unwrap();
    }
    let tree = scan_dir(dir.path());
    let state = AppState::default();
    let generation = state.install_tree(tree);
    let a = state
        .children(generation, 0, 0, 10, ListOrder::FOLDERS)
        .unwrap()
        .items[0]
        .id;
    let rank = |order| state.crumbs(generation, a, order).unwrap()[1].rank;
    let by_size = ListOrder {
        key: SortKey::Size,
        descending: true,
        dirs_only: true,
    };
    // "a" is first by name and last by size, largest first; no order means by name.
    assert_eq!(
        (
            rank(None),
            rank(Some(ListOrder::FOLDERS)),
            rank(Some(by_size))
        ),
        (0, 0, 1)
    );
}

#[test]
fn positions_follow_the_order() {
    let state = AppState::default();
    let (_dir, tree) = scanned_tree();
    let generation = state.install_tree(tree);
    let names =
        |page: &ChildrenDto| -> Vec<String> { page.items.iter().map(|i| i.name.clone()).collect() };
    let folders = state
        .children(generation, 0, 0, 10, ListOrder::FOLDERS)
        .unwrap();
    assert_eq!(names(&folders), ["sub"]);
    let by_name = ListOrder {
        key: SortKey::Name,
        descending: false,
        dirs_only: false,
    };
    let page = state.children(generation, 0, 0, 10, by_name).unwrap();
    assert_eq!(names(&page), ["small.txt", "sub"]);
    for (pos, item) in page.items.iter().enumerate() {
        assert_eq!(
            state.position(generation, item.id, by_name),
            Ok(Some(pos as u32))
        );
    }
    assert_eq!(state.position(generation, 0, by_name), Ok(None));
    assert_eq!(
        state.position(generation + 1, 0, by_name),
        Err(CmdError::StaleId)
    );
}

#[test]
fn details_are_read_per_id_and_capped() {
    let state = AppState::default();
    let (_dir, mut tree) = scanned_tree();
    let sub = tree.children(0).find(|&c| tree.node(c).is_dir()).unwrap();
    let small = tree.children(0).find(|&c| !tree.node(c).is_dir()).unwrap();
    tree.mark_lossy_for_test(sub);
    let generation = state.install_tree(tree);
    let paths = state
        .detail_paths(generation, &[small, sub, 9_999])
        .unwrap();
    assert!(paths[0].1.is_some());
    assert_eq!((&paths[1].1, &paths[2].1), (&None, &None));
    let read = crate::details::read_all(generation, paths);
    assert_eq!(read.generation, generation);
    let ids: Vec<u32> = read.items.iter().map(|d| d.id).collect();
    assert_eq!(ids, [small, sub, 9_999]);
    assert!(read.items[0].attributes.is_some() && read.items[0].owner.is_some());
    assert_eq!(
        (&read.items[1].attributes, read.items[2].created),
        (&None, None)
    );
    let many = vec![small; 600];
    assert_eq!(
        state.detail_paths(generation, &many).unwrap().len(),
        crate::details::MAX_DETAILS
    );
    assert_eq!(
        state.detail_paths(generation + 1, &[small]),
        Err(CmdError::StaleId)
    );
}
