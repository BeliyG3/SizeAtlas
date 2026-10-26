use std::path::PathBuf;

use super::cache::HashCache;
use super::candidates::Candidate;
use super::group::{Group, Location, Object, PathRef, merge_by_id};
use crate::platform::{FileId, Identity};

fn location(node: u32, size: u64, volume: u16) -> Location {
    Location {
        at: PathRef { root: 0, node },
        path: PathBuf::from(format!("f{node}")),
        len: 4096,
        mtime: 1,
        size,
        volume,
    }
}

fn id(file: u128) -> Option<FileId> {
    FileId::new(1, file)
}

/// An object of one path with its own id.
fn object(node: u32, size: u64) -> Object {
    Object {
        paths: vec![location(node, size, 0)],
        id: id(u128::from(node)),
        nlink: 1,
        protected: false,
        synced: false,
        seed: false,
    }
}

fn held(node: u32, size: u64) -> Object {
    Object {
        nlink: 2,
        ..object(node, size)
    }
}

fn group(objects: Vec<Object>) -> Group {
    Group {
        hash: [0; 32],
        len: 4096,
        objects,
        stale: false,
    }
}

fn candidate(node: u32) -> Candidate {
    Candidate {
        root: 0,
        node,
        len: 4096,
        size: 4096,
        mtime: 1,
        protected: false,
        synced: false,
        seed: false,
    }
}

#[test]
fn free_keeps_one_largest_copy() {
    let g = group(vec![object(1, 4096), object(2, 8192), object(3, 8192)]);
    assert_eq!(g.free(), 12_288);
}

#[test]
fn a_protected_copy_is_never_the_kept_one() {
    let protected = Object {
        protected: true,
        ..object(1, 4096)
    };
    assert!(!protected.keepable());
    assert_eq!(group(vec![protected, object(2, 4096)]).free(), 0);
}

#[test]
fn a_held_copy_frees_every_trashable_one() {
    let one = group(vec![held(1, 4096), object(2, 4096), object(3, 4096)]);
    assert_eq!(one.free(), 8192);
    let two = group(vec![held(1, 4096), held(2, 4096), object(3, 4096)]);
    assert_eq!(two.free(), 4096);
    assert!(two.objects[0].outside_links() && !two.objects[0].trashable());
}

#[test]
fn unknown_ids_are_neither_kept_nor_trashed() {
    let unknown = Object {
        id: None,
        ..object(1, 4096)
    };
    assert!(!unknown.trashable() && !unknown.keepable());
    assert_eq!(group(vec![unknown, object(2, 4096)]).free(), 0);
}

#[test]
fn a_group_is_seeded_by_any_object() {
    let seed = Object {
        seed: true,
        ..object(1, 4096)
    };
    assert!(!group(vec![object(1, 4096), object(2, 4096)]).seeded());
    assert!(group(vec![object(2, 4096), seed]).seeded());
}

#[test]
fn merge_by_id_joins_paths_of_one_file() {
    let same = Identity {
        id: id(9),
        nlink: 2,
    };
    let seed = Candidate {
        seed: true,
        ..candidate(2)
    };
    let objects = merge_by_id(vec![
        (location(1, 4096, 0), same, candidate(1)),
        (location(2, 0, 0), same, seed),
    ]);
    assert_eq!(objects.len(), 1);
    let o = &objects[0];
    assert_eq!(o.paths.len(), 2);
    assert_eq!(o.size(), 4096);
    assert!(o.seed && !o.protected && !o.outside_links());
}

#[test]
fn merge_by_id_never_joins_unknown_ids() {
    let unknown = Identity { id: None, nlink: 1 };
    let objects = merge_by_id(vec![
        (location(1, 4096, 0), unknown, candidate(1)),
        (location(2, 4096, 0), unknown, candidate(2)),
    ]);
    assert_eq!(objects.len(), 2);
}

#[test]
fn merge_by_id_never_joins_ids_of_two_volumes() {
    let same = Identity {
        id: id(9),
        nlink: 1,
    };
    let other = Identity {
        id: id(5),
        nlink: 1,
    };
    let objects = merge_by_id(vec![
        (location(1, 4096, 0), same, candidate(1)),
        (location(2, 4096, 1), same, candidate(2)),
        (location(3, 4096, 1), other, candidate(3)),
    ]);
    assert_eq!(objects.len(), 3);
    assert!(!objects[0].keepable() && !objects[1].keepable());
    assert!(objects[2].keepable(), "an id of one volume stays");
}

#[test]
fn zero_ids_are_unknown() {
    assert_eq!(FileId::new(7, 0), None);
    assert!(FileId::new(7, 1).is_some());
}

#[test]
fn a_cached_hash_needs_the_same_length_and_time() {
    let mut cache = HashCache::default();
    let file = id(3).unwrap();
    cache.put_prefix("C:\\", file, 4096, 10, [1; 32]);
    cache.put_full("C:\\", file, 4096, 10, [2; 32]);
    let got = cache.get("C:\\", file, 4096, 10).unwrap();
    assert_eq!((got.prefix, got.full), (Some([1; 32]), Some([2; 32])));
    assert!(cache.get("C:\\", file, 4096, 11).is_none(), "another time");
    assert!(
        cache.get("C:\\", file, 4097, 10).is_none(),
        "another length"
    );
    assert!(
        cache.get("D:\\", file, 4096, 10).is_none(),
        "another volume"
    );
    cache.put_prefix("C:\\", file, 4096, 11, [3; 32]);
    let got = cache.get("C:\\", file, 4096, 11).unwrap();
    assert_eq!((got.prefix, got.full), (Some([3; 32]), None), "replaced");
    assert_eq!(cache.len(), 1);
    cache.put_full("C:\\", file, 4096, 0, [4; 32]);
    assert!(
        cache.get("C:\\", file, 4096, 0).is_none(),
        "an unknown time"
    );
}
