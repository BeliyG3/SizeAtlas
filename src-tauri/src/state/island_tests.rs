use std::fs;
use std::sync::atomic::Ordering;

use super::*;

const GIB: u64 = 1 << 30;

fn scans(list: &[(&str, u64)]) -> Vec<(String, u64)> {
    list.iter().map(|&(r, u)| (r.to_owned(), u)).collect()
}

fn free_of(root: &str) -> u64 {
    root.len() as u64
}

#[test]
fn islands_keep_the_open_root_and_skip_nested_ones() {
    let all = scans(&[
        ("C:\\", 90 * GIB),
        ("C:\\Program Files", 20 * GIB),
        ("W:\\AI_Proj", 40 * GIB),
    ]);
    let (list, me) = islands("C:\\Program Files", 20 * GIB, &all, free_of);
    assert_eq!(
        list,
        [
            (40 * GIB, free_of("W:\\AI_Proj")),
            (20 * GIB, free_of("C:\\Program Files"))
        ]
    );
    assert_eq!(me, 1);
}

#[test]
fn islands_keep_the_outer_of_two_nested_scans() {
    let all = scans(&[("D:\\a\\b", GIB), ("D:\\a", 3 * GIB), ("E:\\", 2 * GIB)]);
    let (list, me) = islands("W:\\x", 5 * GIB, &all, |_| 0);
    assert_eq!(list, [(5 * GIB, 0), (3 * GIB, 0), (2 * GIB, 0)]);
    assert_eq!(me, 0);
}

#[test]
fn at_most_eight_islands() {
    let all: Vec<(String, u64)> = (0..20).map(|i| (format!("D:\\r{i}"), i * GIB)).collect();
    let (list, me) = islands("W:\\open", GIB / 2, &all, |_| 0);
    assert_eq!(list.len(), 8);
    // The open root is the smallest here and still stands; the others are the biggest.
    assert_eq!(list[me].0, GIB / 2);
    assert_eq!(list[0].0, 19 * GIB);
    assert!(list.windows(2).all(|w| w[0].0 >= w[1].0));
}

#[test]
fn paths_compare_by_component() {
    let (list, _) = islands("C:\\A", GIB, &scans(&[("C:\\AB", GIB)]), |_| 0);
    assert_eq!(list.len(), 2);
    let nested = scans(&[("C:/A/B", GIB), ("C:\\A", GIB)]);
    let (list, _) = islands("C:\\A\\", GIB, &nested, |_| 0);
    assert_eq!(list.len(), 1);
}

#[cfg(windows)]
#[test]
fn windows_paths_ignore_case() {
    let (list, _) = islands("C:\\Users", GIB, &scans(&[("c:\\users", GIB)]), |_| 0);
    assert_eq!(list.len(), 1);
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

#[test]
fn city_answers_from_memory_for_the_same_key() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = state.install_tree(tree_in(dir.path()));
    let first = state.city(generation, cache.path()).unwrap();
    let second = state.city(generation, cache.path()).unwrap();
    assert_eq!(first, second);
    assert_eq!(state.0.city.builds.load(Ordering::Relaxed), 1);
    // Another generation (here another root) is another key.
    let other = state.install_tree(tree_in(&dir.path().join("sub")));
    state.city(other, cache.path()).unwrap();
    assert_eq!(state.0.city.builds.load(Ordering::Relaxed), 2);
}

#[test]
fn city_keeps_stale_id_for_another_generation() {
    let (dir, cache) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let generation = state.install_tree(tree_in(dir.path()));
    assert_eq!(
        state.city(generation + 1, cache.path()),
        Err(CmdError::StaleId)
    );
    state.city(generation, cache.path()).unwrap();
    assert_eq!(
        state.city(generation + 1, cache.path()),
        Err(CmdError::StaleId)
    );
}
