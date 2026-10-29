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
    // Each island carries the rev of the tree behind its `get_city` bytes.
    for island in &world.islands {
        let rev = state.tree(island.generation).unwrap().rev;
        assert_eq!(island.rev, rev);
        assert_eq!(state.0.city.island(island.generation).unwrap().0, rev);
    }
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
    // Alone, its land box is centred on the origin.
    let (_, built) = state.0.city.island(folder).unwrap();
    let at = city::place(&[&*built])[0];
    let island = &world.islands[0];
    assert!(island.x.is_finite() && island.z.is_finite());
    assert_eq!([island.x, island.z], at);
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
            rev: 9,
            build: 4,
            root: "C:\\".into(),
            x: 1.5,
            z: -2.0,
        }],
        bridges: vec![ArchipelagoBridgeDto {
            a: [0, 4],
            b: [1, 7],
            points: vec![[0.0, 1.0], [2.0, 3.0]],
            levels: vec![1],
        }],
    };
    assert_eq!(
        serde_json::to_value(world).unwrap(),
        serde_json::json!({
            "islands": [{"generation": 3, "rev": 9, "build": 4, "root": "C:\\", "x": 1.5, "z": -2.0}],
            "bridges": [{"a": [0, 4], "b": [1, 7], "points": [[0.0, 1.0], [2.0, 3.0]], "levels": [1]}],
        })
    );
}

/// Four drives open, each a tree of its own size; their generations and mount points.
fn four_drives(state: &AppState, dirs: &[tempfile::TempDir]) -> (Vec<u64>, Vec<String>) {
    let sizes = [20_000, 200_000, 600_000, 5_000];
    let generations = (dirs.iter().zip(sizes))
        .map(|(d, bytes)| state.install_tree(tree_in(d.path(), bytes)))
        .collect();
    (generations, dirs.iter().map(path_of).collect())
}

/// `get_city` of a member serves the island the archipelago placed and bridged, built again
/// facing where the others stand: its bytes, its rev, the gates its bridges start from; asking
/// again builds nothing. The first pass foresees every direction a quarter turn off, so the
/// second always runs.
#[test]
fn get_city_matches_archipelago() {
    let dirs: Vec<_> = (0..4).map(|_| tempfile::tempdir().unwrap()).collect();
    let state = AppState::default();
    let (_, mounts) = four_drives(&state, &dirs);
    let (list, revs) = state.open_members(&mounts, &[]);
    let sizes: Vec<(u64, u64)> = list.iter().map(|m| (m.used, m.free)).collect();
    let turned: Vec<Vec<f32>> = (0..list.len())
        .map(|i| {
            let ahead = city::directions(&sizes, i).into_iter();
            ahead.map(|a| a + std::f32::consts::FRAC_PI_2).collect()
        })
        .collect();
    let (kept, at) = state.settle_with(&list, &revs, &turned, true).unwrap();
    assert_eq!(builds(&state), 2 * list.len());
    let bridges = city::bridges(&kept.iter().map(|k| &*k.1).collect::<Vec<_>>(), &at);
    for (k, (member, (rev, island, _, build))) in list.iter().zip(&kept).enumerate() {
        let bytes = state.city_in(member.generation, &mounts, &[]).unwrap();
        let tree = state.tree(member.generation).unwrap();
        assert_eq!(*rev, tree.rev);
        let want = city::encode_city(member.generation, *rev, *build, tree.approximate, island);
        assert!(
            bytes == want,
            "island {k}: get_city bytes are another island"
        );
        for b in &bridges {
            for (i, node) in [b.a, b.b] {
                let gate = island.gates.iter().any(|g| g.node == node);
                assert!(i != k || gate, "island {k}: no gate at node {node}");
            }
        }
    }
    assert_eq!(builds(&state), 2 * list.len());
}

/// Callers that find the cache cold at once wait for one of them to settle the archipelago.
#[test]
fn cold_callers_build_once() {
    let dirs: Vec<_> = (0..2).map(|_| tempfile::tempdir().unwrap()).collect();
    let state = AppState::default();
    let generations: Vec<u64> = (dirs.iter().zip([10_000, 20_000]))
        .map(|(d, bytes)| state.install_tree(tree_in(d.path(), bytes)))
        .collect();
    let mounts: Vec<String> = dirs.iter().map(path_of).collect();
    let start = std::sync::Barrier::new(3);
    std::thread::scope(|scope| {
        let city = |g: u64| {
            let (state, start, mounts) = (&state, &start, &mounts);
            move || {
                start.wait();
                state.city_in(g, mounts, &[]).unwrap();
            }
        };
        scope.spawn(city(generations[0]));
        scope.spawn(city(generations[1]));
        start.wait();
        state.archipelago_in(generations[0], &mounts, &[]).unwrap();
    });
    assert_eq!(builds(&state), 2);
}

/// `get_city` serves the island the archipelago placed, whatever the free space did since: a
/// change shows when the archipelago is laid out again.
#[test]
fn get_city_keeps_the_archipelago_island_when_free_space_moves() {
    const GIB: u64 = 1 << 30;
    let dirs: Vec<_> = (0..2).map(|_| tempfile::tempdir().unwrap()).collect();
    let state = AppState::default();
    let generations: Vec<u64> = (dirs.iter().zip([10_000, 20_000]))
        .map(|(d, bytes)| state.install_tree(tree_in(d.path(), bytes)))
        .collect();
    let mounts: Vec<String> = dirs.iter().map(path_of).collect();
    let disks =
        |free: u64| -> Vec<(String, u64)> { mounts.iter().map(|m| (m.clone(), free)).collect() };
    let world = state
        .archipelago_in(generations[0], &mounts, &disks(GIB))
        .unwrap();
    let laid = state.city_in(generations[1], &mounts, &disks(GIB)).unwrap();
    let built = builds(&state);
    let later = state
        .city_in(generations[1], &mounts, &disks(9 * GIB))
        .unwrap();
    assert!(later == laid, "get_city moved off the archipelago's island");
    assert_eq!(builds(&state), built);
    assert_eq!(
        state.0.city.island(generations[1]).unwrap().0,
        world.islands[1].rev
    );
    // Laid out again, the archipelago takes the new free space.
    state
        .archipelago_in(generations[0], &mounts, &disks(9 * GIB))
        .unwrap();
    assert_eq!(builds(&state), built + 2);
}

/// With no island in memory, `get_city` of a member builds the archipelago's island: the
/// archipelago then builds nothing more.
#[test]
fn get_city_first_builds_the_archipelago() {
    let dirs: Vec<_> = (0..4).map(|_| tempfile::tempdir().unwrap()).collect();
    let state = AppState::default();
    let (generations, mounts) = four_drives(&state, &dirs);
    let bytes = state.city_in(generations[1], &mounts, &[]).unwrap();
    let built = builds(&state);
    state.archipelago_in(generations[0], &mounts, &[]).unwrap();
    assert_eq!(builds(&state), built);
    assert_eq!(state.city_in(generations[1], &mounts, &[]).unwrap(), bytes);
}

/// One island, or two (the second always on its ray from the first), already face where they
/// stand: each is built once.
#[test]
fn second_pass_skipped_when_close() {
    let dirs: Vec<_> = (0..2).map(|_| tempfile::tempdir().unwrap()).collect();
    let state = AppState::default();
    let first = state.install_tree(tree_in(dirs[0].path(), 10_000));
    let mounts: Vec<String> = dirs.iter().map(path_of).collect();
    state.archipelago_in(first, &mounts, &[]).unwrap();
    assert_eq!(builds(&state), 1);
    state.install_tree(tree_in(dirs[1].path(), 10_000));
    state.archipelago_in(first, &mounts, &[]).unwrap();
    assert_eq!(builds(&state), 3);
}

/// A scan that changes a member's tree while the archipelago is laid out gets the tree: the
/// layout holds no copy of a tree while it waits for the data lock (a change waits for every
/// copy to go, holding the write lock).
#[test]
fn a_change_meanwhile_does_not_deadlock() {
    let dirs: Vec<_> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
    let state = AppState::default();
    let generations: Vec<u64> = (dirs.iter().zip([10_000, 20_000, 40_000]))
        .map(|(d, bytes)| state.install_tree(tree_in(d.path(), bytes)))
        .collect();
    let mounts: Vec<String> = dirs.iter().map(path_of).collect();
    let (done, finished) = std::sync::mpsc::channel();
    let state = std::sync::Arc::new(state);
    let worker = {
        let (state, mounts, done) = (state.clone(), mounts.clone(), done.clone());
        let selected = generations[0];
        std::thread::spawn(move || {
            for _ in 0..20 {
                state.archipelago_in(selected, &mounts, &[]).unwrap();
            }
            done.send(()).unwrap();
        })
    };
    let changer = {
        let (state, changed) = (state.clone(), generations[1]);
        std::thread::spawn(move || {
            for _ in 0..200 {
                // A new rev, so every layout builds this island again.
                state.change_tree(changed, |tree| {
                    tree.rev += 1;
                    Some(())
                });
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            done.send(()).unwrap();
        })
    };
    for _ in 0..2 {
        finished
            .recv_timeout(std::time::Duration::from_secs(60))
            .expect("the layout and a change of a tree wait for each other");
    }
    worker.join().unwrap();
    changer.join().unwrap();
}
