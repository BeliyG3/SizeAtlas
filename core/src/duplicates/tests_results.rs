use std::collections::BTreeMap;
use std::path::PathBuf;

use super::Unread;
use super::group::{Group, Location, Object, PathRef};
use super::hash::Hash;
use super::results::{Results, RootMark};
use crate::platform::FileId;

fn object(node: u32) -> Object {
    Object {
        paths: vec![Location {
            at: PathRef { root: 0, node },
            path: PathBuf::from(format!("f{node}")),
            len: 4096,
            mtime: 1,
            size: 4096,
            volume: 0,
        }],
        id: FileId::new(1, u128::from(node)),
        nlink: 1,
        protected: false,
        synced: false,
        seed: false,
    }
}

fn hash(h: u8) -> Hash {
    [h; 32]
}

/// A group with this hash and one object per node.
fn group(h: u8, nodes: &[u32]) -> Group {
    Group {
        hash: hash(h),
        len: 4096,
        objects: nodes.iter().map(|&n| object(n)).collect(),
        stale: false,
    }
}

fn at(node: u32) -> PathRef {
    PathRef { root: 0, node }
}

fn roots() -> Vec<RootMark> {
    vec![RootMark {
        path: "r".into(),
        generation: 1,
        rev: 0,
    }]
}

fn hashes(r: &Results, job: u64, cursor: u64) -> Vec<Hash> {
    r.since(job, cursor).groups.iter().map(|g| g.hash).collect()
}

#[test]
fn a_late_group_of_an_old_job_is_ignored() {
    let mut r = Results::new(2, roots(), None);
    assert!(!r.upsert(1, group(1, &[1, 2])));
    assert_eq!(r.version, 0);
    assert!(r.since(2, 0).groups.is_empty());
}

#[test]
fn since_gives_only_what_changed_after_the_cursor() {
    let mut r = Results::new(7, roots(), None);
    assert!(r.upsert(7, group(1, &[1, 2])));
    assert!(r.upsert(7, group(2, &[3, 4])));
    assert_eq!(r.version, 2);
    assert!(!r.since(7, 1).full);
    assert_eq!(hashes(&r, 7, 1), vec![hash(2)]);
    let all = r.since(7, 0);
    assert!(all.full);
    assert_eq!(all.groups.len(), 2);
    assert!(r.since(8, 5).full);
}

#[test]
fn removing_a_copy_edits_the_group_in_place() {
    let mut r = Results::new(1, roots(), None);
    r.upsert(1, group(1, &[1, 2, 3]));
    let v = r.version;
    r.remove(&[at(3)]);
    assert_eq!(r.version, v + 1);
    let delta = r.since(1, v);
    assert_eq!(delta.groups.len(), 1);
    assert_eq!(delta.groups[0].objects.len(), 2);
    let v = r.version;
    r.remove(&[at(2)]);
    assert_eq!(r.groups().count(), 0);
    let delta = r.since(1, v);
    assert!(delta.groups.is_empty());
    assert_eq!(delta.removed, vec![hash(1)]);
}

#[test]
fn removing_one_path_keeps_an_object_with_other_paths() {
    let mut r = Results::new(1, roots(), None);
    let mut linked = object(1);
    linked.paths.push(object(9).paths.remove(0));
    let mut g = group(1, &[2]);
    g.objects.push(linked);
    r.upsert(1, g);
    r.remove(&[at(9)]);
    let g = r.groups().next().unwrap();
    assert_eq!(g.objects.len(), 2);
    assert_eq!(g.objects[1].paths.len(), 1);
    // A path no group holds changes nothing.
    r.remove(&[at(404)]);
    assert_eq!(r.version, 2);
}

#[test]
fn find_gives_the_group_and_object_of_a_path() {
    let mut r = Results::new(1, roots(), None);
    r.upsert(1, group(1, &[1, 2]));
    r.upsert(1, group(2, &[3, 4]));
    let (g, i) = r.find(at(4)).unwrap();
    assert_eq!((g.hash, i), (hash(2), 1));
    assert!(r.find(at(5)).is_none());
}

#[test]
fn mark_stale_flags_the_group() {
    let mut r = Results::new(1, roots(), None);
    r.upsert(1, group(1, &[1, 2]));
    let v = r.version;
    r.mark_stale(&hash(1));
    let delta = r.since(1, v);
    assert_eq!(delta.groups.len(), 1);
    assert!(delta.groups[0].stale);
    // An unknown group changes nothing.
    r.mark_stale(&hash(9));
    assert_eq!(r.version, v + 1);
}

#[test]
fn finish_of_an_old_job_is_ignored() {
    let mut r = Results::new(2, roots(), None);
    let unread = Unread {
        cloud: 3,
        ..Unread::default()
    };
    assert!(!r.finish(1, true, unread.clone()));
    assert!(!r.complete && r.version == 0 && r.unread.cloud == 0);
    assert!(r.finish(2, true, unread));
    assert!(r.complete && r.unread.cloud == 3 && r.version == 1);
}

#[test]
fn upsert_replaces_a_group_with_the_same_hash() {
    let mut r = Results::new(1, roots(), None);
    r.upsert(1, group(1, &[1, 2]));
    r.upsert(1, group(1, &[1, 2, 3]));
    let all = r.since(1, 0);
    assert_eq!(all.groups.len(), 1);
    assert_eq!(all.groups[0].objects.len(), 3);
}

#[test]
fn a_resumed_job_starts_with_the_old_groups() {
    let mut old = Results::new(1, roots(), None);
    old.upsert(1, group(1, &[1, 2]));
    old.upsert(1, group(2, &[3, 4]));
    let mut r = Results::new(2, roots(), Some(&old));
    assert_eq!(r.version, 0);
    assert_eq!(hashes(&r, 2, 0).len(), 2);
    // The new job finds only the second group again.
    r.upsert(2, group(2, &[3, 4]));
    r.finish(2, true, Unread::default());
    assert_eq!(hashes(&r, 2, 0), vec![hash(2)]);
    assert_eq!(r.since(2, 1).removed, vec![hash(1)]);
}

#[test]
fn an_incomplete_finish_keeps_the_old_groups() {
    let mut old = Results::new(1, roots(), None);
    old.upsert(1, group(1, &[1, 2]));
    let mut r = Results::new(2, roots(), Some(&old));
    r.finish(2, false, Unread::default());
    assert_eq!(r.groups().count(), 1);
    assert!(!r.complete);
}

#[test]
fn a_removed_group_found_again_is_no_longer_removed() {
    let mut r = Results::new(1, roots(), None);
    r.upsert(1, group(1, &[1, 2]));
    r.remove(&[at(1)]);
    assert!(r.upsert(1, group(1, &[1, 2])));
    assert!(r.since(1, 1).removed.is_empty());
    assert_eq!(hashes(&r, 1, 1), vec![hash(1)]);
}

#[test]
fn a_previous_result_of_other_roots_carries_nothing() {
    let mut old = Results::new(1, roots(), None);
    old.upsert(1, group(1, &[1, 2]));
    let rescanned = vec![RootMark {
        generation: 2,
        ..roots().remove(0)
    }];
    let r = Results::new(2, rescanned, Some(&old));
    assert_eq!(r.groups().count(), 0);
    assert_eq!(Results::new(2, roots(), Some(&old)).groups().count(), 1);
}

#[test]
fn marking_a_stale_group_again_changes_nothing() {
    let mut r = Results::new(1, roots(), None);
    r.upsert(1, group(1, &[1, 2]));
    r.mark_stale(&hash(1));
    let v = r.version;
    r.mark_stale(&hash(1));
    assert_eq!(r.version, v);
}

/// What a reader keeps of the result: per hash, the object count and the stale flag.
type View = BTreeMap<Hash, (usize, bool)>;

fn apply(view: &mut View, r: &Results, job: u64, cursor: u64) {
    let delta = r.since(job, cursor);
    if delta.full {
        view.clear();
    }
    for h in &delta.removed {
        assert!(view.remove(h).is_some() || !delta.full);
    }
    for g in &delta.groups {
        assert!(!delta.removed.contains(&g.hash));
        view.insert(g.hash, (g.objects.len(), g.stale));
    }
}

#[test]
fn deltas_from_every_cursor_replay_to_the_full_result() {
    let mut old = Results::new(1, roots(), None);
    old.upsert(1, group(4, &[40, 41]));
    old.upsert(1, group(5, &[50, 51]));
    let mut r = Results::new(2, roots(), Some(&old));
    let mut seen: Vec<(u64, View)> = Vec::new();
    let mut note = |r: &Results| {
        let mut view = View::new();
        apply(&mut view, r, r.job, 0);
        seen.push((r.version, view));
    };
    note(&r);
    r.upsert(2, group(1, &[1, 2]));
    note(&r);
    r.upsert(2, group(2, &[3, 4, 5]));
    note(&r);
    r.upsert(2, group(2, &[3, 4]));
    note(&r);
    r.remove(&[at(1)]);
    note(&r);
    r.upsert(2, group(1, &[1, 2]));
    note(&r);
    r.mark_stale(&hash(2));
    note(&r);
    r.remove(&[at(50)]);
    note(&r);
    r.upsert(2, group(3, &[6, 7]));
    r.finish(2, true, Unread::default());
    note(&r);
    let (_, last) = seen.last().unwrap().clone();
    assert_eq!(
        last.keys().copied().collect::<Vec<_>>(),
        vec![hash(1), hash(2), hash(3)]
    );
    for (cursor, mut view) in seen {
        apply(&mut view, &r, 2, cursor);
        assert_eq!(view, last, "from cursor {cursor}");
    }
}
