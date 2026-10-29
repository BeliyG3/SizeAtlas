use std::fs;
use std::path::Path;
use std::sync::atomic::Ordering;

use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};
use sizeatlas_core::tree::Tree;

use super::*;
use crate::dto::{ArchipelagoBridgeDto, ArchipelagoIslandDto};

/// A tree of `dir` with one file of `bytes`.
fn tree_in(dir: &Path, bytes: usize) -> Tree {
    use std::sync::atomic::AtomicBool;
    fs::create_dir_all(dir.join("sub")).unwrap();
    fs::write(dir.join("sub").join("big.bin"), vec![0u8; bytes]).unwrap();
    let ScanOutcome::Done(tree) = scan(dir, &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    tree
}

fn path_of(dir: &tempfile::TempDir) -> String {
    dir.path().to_str().unwrap().to_owned()
}

fn builds(state: &AppState) -> usize {
    state.0.city.builds.load(Ordering::Relaxed)
}

fn offsets(world: &ArchipelagoDto) -> Vec<[f32; 2]> {
    world.islands.iter().map(|i| [i.x, i.z]).collect()
}

#[test]
fn archipelago_lists_members_in_order() {
    let dirs: Vec<_> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
    let state = AppState::default();
    // Opened from the smallest, listed from the biggest.
    let sizes = [20_000, 200_000, 2_000_000];
    let generations: Vec<u64> = dirs
        .iter()
        .zip(sizes)
        .map(|(d, bytes)| state.install_tree(tree_in(d.path(), bytes)))
        .collect();
    let mounts: Vec<String> = dirs.iter().map(path_of).collect();
    let world = state.archipelago_in(generations[0], &mounts, &[]).unwrap();
    let listed: Vec<u64> = world.islands.iter().map(|i| i.generation).collect();
    assert_eq!(listed, [generations[2], generations[1], generations[0]]);
    assert_eq!(world.islands[0].root, mounts[2]);
    assert_eq!(world.bridges.len(), 3);
    // Every member sees the same world, whichever is selected.
    let other = state.archipelago_in(generations[2], &mounts, &[]).unwrap();
    assert_eq!(offsets(&world), offsets(&other));
}

#[test]
fn archipelago_selected_folder_is_alone() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    state.install_tree(tree_in(a.path(), 10_000));
    state.install_tree(tree_in(b.path(), 10_000));
    let folder = state.install_tree(tree_in(&a.path().join("sub"), 10_000));
    let mounts = vec![path_of(&a), path_of(&b)];
    let world = state.archipelago_in(folder, &mounts, &[]).unwrap();
    assert_eq!(world.islands.len(), 1);
    assert_eq!(world.islands[0].generation, folder);
    assert!(world.bridges.is_empty());
}

#[test]
fn archipelago_builds_islands_once() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let ga = state.install_tree(tree_in(a.path(), 10_000));
    state.install_tree(tree_in(b.path(), 20_000));
    let mounts = vec![path_of(&a), path_of(&b)];
    state.archipelago_in(ga, &mounts, &[]).unwrap();
    assert_eq!(builds(&state), 2);
    state.archipelago_in(ga, &mounts, &[]).unwrap();
    assert_eq!(builds(&state), 2);
}

#[test]
fn stale_selected_is_stale_id() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::default();
    let generation = state.install_tree(tree_in(dir.path(), 10_000));
    let mounts = vec![path_of(&dir)];
    assert_eq!(
        state.archipelago_in(generation + 1, &mounts, &[]),
        Err(CmdError::StaleId)
    );
    assert_eq!(builds(&state), 0);
}

#[test]
fn archipelago_serializes_for_the_ui() {
    let world = ArchipelagoDto {
        islands: vec![ArchipelagoIslandDto {
            generation: 3,
            root: "C:\\".into(),
            x: 1.5,
            z: -2.0,
        }],
        bridges: vec![ArchipelagoBridgeDto {
            a: [0, 4],
            b: [1, 7],
            points: vec![[0.0, 1.0], [2.0, 3.0]],
            level: 1,
        }],
    };
    assert_eq!(
        serde_json::to_value(world).unwrap(),
        serde_json::json!({
            "islands": [{"generation": 3, "root": "C:\\", "x": 1.5, "z": -2.0}],
            "bridges": [{"a": [0, 4], "b": [1, 7], "points": [[0.0, 1.0], [2.0, 3.0]], "level": 1}],
        })
    );
}
