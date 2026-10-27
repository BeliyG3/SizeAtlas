//! The search on real files: reads by step, changed and gone files, filters, cancel, the cache
//! and progress.

use std::sync::atomic::AtomicBool;
use std::time::Duration;

use super::tests::*;
use super::{Event, Phase};

fn blake(bytes: &[u8]) -> [u8; 32] {
    *blake3::hash(bytes).as_bytes()
}

fn reads(out: &super::Outcome) -> u64 {
    out.stats.prefix_reads + out.stats.tail_reads + out.stats.full_reads
}

#[test]
fn pairs_are_grouped_by_their_full_hash() {
    let d = dir();
    let bytes = data(3 * MIB);
    put(d.path(), "a", &bytes);
    put(d.path(), "b", &bytes);
    let mut other = bytes.clone();
    other[3 * MIB / 2] ^= 1;
    put(d.path(), "c", &other);
    let (groups, out, _) = run(&[&scan_of(d.path())], "", &cache());
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].hash, blake(&bytes));
    assert_eq!(names(&groups[0]), ["a", "b"]);
    assert!(out.complete);
}

#[test]
fn files_that_differ_at_the_start_are_never_read_in_full() {
    let d = dir();
    let bytes = data(100 * 1024);
    put(d.path(), "a", &bytes);
    let mut other = bytes.clone();
    other[0] ^= 1;
    put(d.path(), "b", &other);
    let (groups, out, _) = run(&[&scan_of(d.path())], "", &cache());
    assert!(groups.is_empty());
    assert_eq!(out.stats.prefix_reads, 2);
    assert_eq!(out.stats.tail_reads, 0);
    assert_eq!(out.stats.full_reads, 0);
}

#[test]
fn a_file_up_to_16_kib_is_read_once() {
    let d = dir();
    for (name, len) in [("a", 16_384), ("b", 16_384), ("c", 10_000), ("d", 10_000)] {
        put(d.path(), name, &data(len));
    }
    let (groups, out, _) = run(&[&scan_of(d.path())], "", &cache());
    assert_eq!(groups.len(), 2);
    assert_eq!(out.stats.prefix_reads, 4);
    assert_eq!(out.stats.tail_reads, 0);
    assert_eq!(out.stats.full_reads, 0);
}

#[test]
fn a_file_up_to_1_mib_has_no_tail_read() {
    let d = dir();
    let bytes = data(MIB);
    put(d.path(), "a", &bytes);
    put(d.path(), "b", &bytes);
    let (groups, out, _) = run(&[&scan_of(d.path())], "", &cache());
    assert_eq!(groups.len(), 1);
    assert_eq!(out.stats.tail_reads, 0);
    assert_eq!(out.stats.full_reads, 2);
}

#[test]
fn same_start_and_end_with_a_different_middle_are_two_files() {
    let d = dir();
    let bytes = data(3 * MIB);
    put(d.path(), "a", &bytes);
    let mut other = bytes.clone();
    other[1_572_864] ^= 1;
    put(d.path(), "b", &other);
    let (groups, out, _) = run(&[&scan_of(d.path())], "", &cache());
    assert!(groups.is_empty());
    assert_eq!(out.stats.tail_reads, 2);
    assert_eq!(out.stats.full_reads, 2);
}

#[test]
fn only_shared_lengths_are_opened() {
    let d = dir();
    put(d.path(), "a", &data(5000));
    let mut other = data(5000);
    other[0] ^= 1;
    put(d.path(), "b", &other);
    put(d.path(), "c", &data(6000));
    put(d.path(), "d", &data(4095));
    put(d.path(), "e", &data(4095));
    let (groups, out, _) = run(&[&scan_of(d.path())], "", &cache());
    assert_eq!(out.stats.opened, 2);
    assert!(groups.is_empty());
}

#[test]
fn filters_never_split_a_pair() {
    let d = dir();
    let img = put(d.path(), "IMG_1234.jpg", &data(5000));
    date(&img, Duration::from_secs(2 * 365 * 86_400));
    put(d.path(), "holiday.jpg", &data(5000));
    // Another pair of the same length, seeded by neither query: never shown.
    let mut other = data(5000);
    other[0] ^= 1;
    put(d.path(), "x.jpg", &other);
    put(d.path(), "y.jpg", &other);
    let tree = scan_of(d.path());
    for query in ["holiday", "older:1y"] {
        let (groups, _, _) = run(&[&tree], query, &cache());
        assert_eq!(
            all_names(&groups),
            [["IMG_1234.jpg", "holiday.jpg"]],
            "{query}"
        );
    }
    let (groups, _, _) = run(&[&tree], "type:video", &cache());
    assert!(groups.is_empty());
}

#[test]
fn cancel_before_start_reads_nothing() {
    let d = dir();
    put(d.path(), "a", &data(5000));
    put(d.path(), "b", &data(5000));
    let p = prepared(&[&scan_of(d.path())], "");
    let (groups, out, _) = finish(p, &cache(), &AtomicBool::new(true), false);
    assert!(!out.complete);
    assert_eq!(out.stats.opened, 0);
    assert!(groups.is_empty());
}

#[test]
fn cancel_keeps_what_was_found() {
    let d = dir();
    for (name, len) in [("a", 5000), ("b", 5000), ("c", 6000), ("d", 6000)] {
        put(d.path(), name, &data(len));
    }
    let p = prepared(&[&scan_of(d.path())], "");
    let (groups, out, _) = finish(p, &cache(), &AtomicBool::new(false), true);
    assert!(!out.complete);
    assert_eq!(groups.len(), 1);
}

#[test]
fn a_second_run_reads_no_content_of_unchanged_files() {
    let d = dir();
    let bytes = data(3 * MIB);
    put(d.path(), "a", &bytes);
    let b = put(d.path(), "b", &bytes);
    let cache = cache();
    let tree = scan_of(d.path());
    let (first, out, _) = run(&[&tree], "", &cache);
    assert!(reads(&out) > 0);
    let (second, out, _) = run(&[&tree], "", &cache);
    assert_eq!(reads(&out), 0);
    assert_eq!(all_names(&second), all_names(&first));
    assert_eq!(second[0].hash, first[0].hash);

    rewrite(&b, &bytes);
    let (third, out, _) = run(&[&scan_of(d.path())], "", &cache);
    assert_eq!(out.stats.prefix_reads, 1);
    assert_eq!(all_names(&third), all_names(&first));
}

#[test]
fn progress_comes_in_two_phases() {
    let d = dir();
    let bytes = data(3 * MIB);
    put(d.path(), "a", &bytes);
    put(d.path(), "b", &bytes);
    let (_, _, events) = run(&[&scan_of(d.path())], "", &cache());
    let progress: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            Event::Progress(p) => Some(*p),
            Event::Group(_) => None,
        })
        .collect();
    assert_eq!(progress.first().unwrap().phase, Phase::Prefix);
    let last = progress.last().unwrap();
    assert_eq!(last.phase, Phase::Full);
    assert_eq!(last.bytes_total, 2 * 3 * MIB as u64);
    assert_eq!(last.bytes_done, last.bytes_total);
}

#[test]
fn the_starts_of_files_are_counted_in_files() {
    // Three files of one length, one of them other: each is opened and read at its start, yet
    // the progress counts three files, as the estimate does.
    let d = dir();
    let bytes = data(5000);
    put(d.path(), "a", &bytes);
    put(d.path(), "b", &bytes);
    let mut other = bytes.clone();
    other[0] ^= 1;
    put(d.path(), "c", &other);
    let (_, _, events) = run(&[&scan_of(d.path())], "", &cache());
    let progress: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            Event::Progress(p) => Some(*p),
            Event::Group(_) => None,
        })
        .collect();
    let starts: Vec<_> = progress
        .iter()
        .filter(|p| p.phase == Phase::Prefix)
        .collect();
    assert!(!starts.is_empty());
    for p in starts {
        assert_eq!(p.files_total, 3, "{p:?}");
        assert!(p.files_done <= p.files_total, "{p:?}");
    }
}

#[test]
fn steps_are_shown_as_a_share_of_the_files() {
    assert_eq!(super::pipeline::files_done(0, 6, 3), 0);
    assert_eq!(super::pipeline::files_done(3, 6, 3), 1);
    assert_eq!(super::pipeline::files_done(6, 6, 3), 3);
    // A total that shrank below what was done, or none at all, never shows more than all.
    assert_eq!(super::pipeline::files_done(7, 6, 3), 3);
    assert_eq!(super::pipeline::files_done(0, 0, 3), 0);
}

#[test]
fn a_root_inside_another_counts_once() {
    let d = dir();
    put(d.path(), "a.jpg", &data(5000));
    put(d.path(), "sub/b.jpg", &data(5000));
    let outer = scan_of(d.path());
    let inner = scan_of(&d.path().join("sub"));
    for (trees, b_root) in [([&outer, &inner], 1), ([&inner, &outer], 0)] {
        let (groups, _, _) = run(&trees, "", &cache());
        assert_eq!(groups.len(), 1);
        let objects = &groups[0].objects;
        assert_eq!(objects.len(), 2);
        assert!(objects.iter().all(|o| o.paths.len() == 1));
        let b = objects.iter().find(|o| o.paths[0].path.ends_with("b.jpg"));
        assert_eq!(b.unwrap().paths[0].at.root, b_root);
    }
}

#[test]
fn a_new_copy_of_a_cached_file_is_found() {
    let d = dir();
    let bytes = data(3 * MIB);
    put(d.path(), "a", &bytes);
    put(d.path(), "b", &bytes);
    let cache = cache();
    run(&[&scan_of(d.path())], "", &cache);
    put(d.path(), "c", &bytes);
    let (groups, out, _) = run(&[&scan_of(d.path())], "", &cache);
    assert_eq!(all_names(&groups), [["a", "b", "c"]]);
    assert_eq!(out.stats.tail_reads, 0);
}
