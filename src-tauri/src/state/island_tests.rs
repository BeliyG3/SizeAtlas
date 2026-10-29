use std::fs;
use std::sync::atomic::Ordering;

use super::*;

const GIB: u64 = 1 << 30;

fn free_of(root: &str) -> u64 {
    root.len() as u64 * FREE_STEP + 5
}

/// Open roots `(generation, root, used)`, generations from 1.
fn open(list: &[(&str, u64)]) -> Vec<(u64, String, u64)> {
    (1..)
        .zip(list)
        .map(|(g, &(root, used))| (g, root.to_owned(), used))
        .collect()
}

fn mounts(list: &[&str]) -> Vec<String> {
    list.iter().map(|m| (*m).to_owned()).collect()
}

fn roots(list: &[Member]) -> Vec<&str> {
    list.iter().map(|m| m.root.as_str()).collect()
}

#[test]
fn members_mac_volumes() {
    let all = open(&[("/", 90 * GIB), ("/Volumes/Data", 40 * GIB)]);
    let list = members(&all, &mounts(&["/", "/Volumes/Data"]), free_of);
    assert_eq!(roots(&list), ["/", "/Volumes/Data"]);
}

#[test]
fn members_are_drives_only() {
    let all = open(&[
        ("C:\\", 500),
        ("C:\\Users", 200),
        ("D:\\Projects", 100),
        ("D:\\", 300),
    ]);
    let list = members(&all, &mounts(&["C:\\", "D:\\"]), free_of);
    assert_eq!(roots(&list), ["C:\\", "D:\\"]);
    // The free space is rounded down to the step.
    assert_eq!(list[0].free, free_of("C:\\") - 5);
    assert_eq!((list[0].generation, list[1].generation), (1, 4));
}

#[test]
fn members_keep_eight_biggest() {
    let names: Vec<String> = (0..10).map(|i| format!("/m{i}")).collect();
    let all: Vec<(u64, String, u64)> = (0..10)
        .map(|i| (i, names[i as usize].clone(), (i + 1) * GIB))
        .collect();
    let list = members(&all, &names, |_| 0);
    assert_eq!(list.len(), 8);
    assert_eq!(list[0].used, 10 * GIB);
    assert_eq!(list[7].used, 3 * GIB);
    assert!(list.windows(2).all(|w| w[0].used >= w[1].used));
}

#[test]
fn paths_compare_by_component() {
    let all = open(&[("C:\\AB", GIB)]);
    assert!(members(&all, &mounts(&["C:\\A"]), |_| 0).is_empty());
    let all = open(&[("C:/A/", GIB)]);
    assert_eq!(members(&all, &mounts(&["C:\\A"]), |_| 0).len(), 1);
}

#[cfg(windows)]
#[test]
fn windows_paths_ignore_case() {
    let all = open(&[("c:\\users", GIB)]);
    assert_eq!(members(&all, &mounts(&["C:\\Users"]), |_| 0).len(), 1);
}

#[test]
fn free_space_takes_the_longest_mount() {
    let disks = [
        ("C:\\".to_owned(), 10),
        ("C:\\mnt\\d".to_owned(), 20),
        ("C:\\mnt\\dd".to_owned(), 30),
    ];
    assert_eq!(free_space("C:\\mnt\\d\\x", &disks, None), 20);
    assert_eq!(free_space("C:\\mnt\\other", &disks, None), 10);
    assert_eq!(free_space("C:\\mnt\\dd", &disks, None), 30);
}

#[test]
fn free_space_falls_back_to_the_cache_then_zero() {
    let disks = [("C:\\".to_owned(), 10)];
    let cached = Some(VolumeUsage {
        total: 100,
        used: 70,
    });
    assert_eq!(free_space("Z:\\x", &disks, cached), 30);
    assert_eq!(free_space("Z:\\x", &disks, None), 0);
    // A disk that answers wins over the cache.
    assert_eq!(free_space("C:\\x", &disks, cached), 10);
}

fn tree_in(dir: &Path) -> sizeatlas_core::tree::Tree {
    use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};
    use std::sync::atomic::AtomicBool;
    fs::create_dir_all(dir.join("sub")).unwrap();
    fs::write(dir.join("sub").join("big.bin"), vec![0u8; 10_000]).unwrap();
    let ScanOutcome::Done(tree) = scan(dir, &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    tree
}

/// The directory as the scan names its root: canonical, so a temp path in 8.3 short form (as on
/// CI runners) still matches.
fn path_of(dir: &tempfile::TempDir) -> String {
    dunce::canonicalize(dir.path())
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned()
}

/// The `neighbours` of every gate of the island `generation`, as the cache holds it.
fn gates_of(state: &AppState, generation: u64) -> Vec<Vec<u32>> {
    let (_, island) = state.0.city.island(generation).unwrap();
    island.gates.iter().map(|g| g.neighbours.clone()).collect()
}

#[test]
fn city_answers_from_memory_for_the_same_key() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::default();
    let generation = state.install_tree(tree_in(dir.path()));
    // The free space given: a real disk's changes while other tests write their files.
    let disks = [(path_of(&dir), GIB)];
    let first = state.archipelago_in(generation, &[], &disks).unwrap();
    let second = state.archipelago_in(generation, &[], &disks).unwrap();
    assert_eq!(first, second);
    assert_eq!(state.0.city.builds.load(Ordering::Relaxed), 1);
    // Another generation (here another root) is another key.
    let other = state.install_tree(tree_in(&dir.path().join("sub")));
    state.archipelago_in(other, &[], &disks).unwrap();
    assert_eq!(state.0.city.builds.load(Ordering::Relaxed), 2);
}

#[test]
fn city_keeps_stale_id_for_another_generation() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = state.install_tree(tree_in(dir.path()));
    assert_eq!(state.city(generation + 1, 1), Err(CmdError::StaleId));
    state.archipelago(generation, cache.path()).unwrap();
    assert_eq!(state.city(generation + 1, 1), Err(CmdError::StaleId));
}

#[test]
fn city_neighbours_are_open_drives() {
    let (a, b, c) = (
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
    );
    let state = AppState::default();
    let ga = state.install_tree(tree_in(a.path()));
    let gb = state.install_tree(tree_in(b.path()));
    let mounts = vec![path_of(&a), path_of(&b), path_of(&c)];
    state.archipelago_in(ga, &mounts, &[]).unwrap();
    assert_eq!(gates_of(&state, ga), [vec![0]]);
    // Saved scans are not read at all (`archipelago_in` has no cache dir); an open folder adds no
    // gate.
    let folder = state.install_tree(tree_in(&a.path().join("sub")));
    state.archipelago_in(ga, &mounts, &[]).unwrap();
    assert_eq!(gates_of(&state, ga), [vec![0]]);
    state.archipelago_in(gb, &mounts, &[]).unwrap();
    assert_eq!(gates_of(&state, gb), [vec![0]]);
    state.archipelago_in(folder, &mounts, &[]).unwrap();
    assert!(gates_of(&state, folder).is_empty());
}

#[test]
fn city_alone_without_gates() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = state.install_tree(tree_in(dir.path()));
    // A folder, not a drive.
    state.archipelago(generation, cache.path()).unwrap();
    assert!(gates_of(&state, generation).is_empty());
    // The only open drive.
    state
        .archipelago_in(generation, &[path_of(&dir)], &[])
        .unwrap();
    assert!(gates_of(&state, generation).is_empty());
}

#[test]
fn cache_keeps_every_member() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let ga = state.install_tree(tree_in(a.path()));
    let gb = state.install_tree(tree_in(b.path()));
    let mounts = vec![path_of(&a), path_of(&b)];
    for generation in [ga, gb, ga] {
        state.archipelago_in(generation, &mounts, &[]).unwrap();
    }
    assert_eq!(state.0.city.builds.load(Ordering::Relaxed), 2);
    assert!(state.0.city.island(gb).is_some());
}

#[test]
fn cache_drops_closed_roots() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let ga = state.install_tree(tree_in(a.path()));
    let gb = state.install_tree(tree_in(b.path()));
    let mounts = vec![path_of(&a), path_of(&b)];
    state.archipelago_in(ga, &mounts, &[]).unwrap();
    state.archipelago_in(gb, &mounts, &[]).unwrap();
    assert!(state.close_path(&path_of(&a)));
    state.archipelago_in(gb, &mounts, &[]).unwrap();
    assert!(state.0.city.island(ga).is_none());
    assert!(state.0.city.island(gb).is_some());
}

#[test]
fn city_notices_free_space_of_a_folder() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::default();
    let generation = state.install_tree(tree_in(dir.path()));
    for free in [10 * GIB, 20 * GIB, 20 * GIB] {
        let disks = [(path_of(&dir), free)];
        state.archipelago_in(generation, &[], &disks).unwrap();
    }
    assert_eq!(state.0.city.builds.load(Ordering::Relaxed), 2);
}

/// The build id in the header of an island's bytes (the last word of its 56 bytes).
fn build_in(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes[52..56].try_into().unwrap())
}

/// Another set of neighbours builds the island again: a new build, though the tree (its rev)
/// did not change. The archipelago and the island's bytes name the same build.
#[test]
fn a_new_layout_gives_an_island_a_new_build_while_its_rev_stays() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let ga = state.install_tree(tree_in(a.path()));
    let mounts = vec![path_of(&a), path_of(&b)];
    let alone = state.archipelago_in(ga, &mounts, &[]).unwrap();
    state.install_tree(tree_in(b.path()));
    let two = state.archipelago_in(ga, &mounts, &[]).unwrap();
    let (before, after) = (
        &alone.islands[0],
        two.islands.iter().find(|i| i.generation == ga).unwrap(),
    );
    assert_eq!(
        (before.generation, before.rev),
        (after.generation, after.rev)
    );
    assert_ne!(before.build, after.build);
    assert_ne!(two.islands[0].build, two.islands[1].build);
    for island in &two.islands {
        let bytes = state.city(island.generation, island.build).unwrap();
        assert_eq!(build_in(&bytes), island.build);
    }
}

/// An island from memory keeps its build: the same picture, the same id.
#[test]
fn a_cache_hit_keeps_its_build() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let ga = state.install_tree(tree_in(a.path()));
    state.install_tree(tree_in(b.path()));
    let mounts = vec![path_of(&a), path_of(&b)];
    let first = state.archipelago_in(ga, &mounts, &[]).unwrap();
    let built = state.0.city.builds.load(Ordering::Relaxed);
    let second = state.archipelago_in(ga, &mounts, &[]).unwrap();
    assert_eq!(state.0.city.builds.load(Ordering::Relaxed), built);
    let ids =
        |w: &crate::dto::ArchipelagoDto| w.islands.iter().map(|i| i.build).collect::<Vec<_>>();
    assert_eq!(ids(&first), ids(&second));
}
