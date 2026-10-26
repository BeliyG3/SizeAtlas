//! Candidates, seeds, buckets by length and the estimate.

use super::candidates::{Candidate, buckets, candidates};
use super::tests_zones::{file, opts, root};
use super::*;
use crate::cleanup::paths::node_path;
use crate::cleanup::tests::{build, it, win};
use crate::tree::{Query, flags};

const DAY_NS: i64 = 86_400_000_000_000;
const NOW_NS: i64 = 20_000 * DAY_NS;

/// The candidates of `trees` (each one root) with `query`, zones left out.
fn run(trees: &[&Tree], query: Option<&str>) -> Vec<Candidate> {
    let known = win().known;
    let query = query.map(|q| Query::parse(q).unwrap());
    let roots: Vec<_> = trees.iter().map(|t| root(t)).collect();
    let opts = Options {
        query: query.as_ref(),
        include_zones: false,
        now_ns: NOW_NS,
        ..opts(Os::Windows, &known)
    };
    candidates(&roots, &opts)
}

fn lens(c: &[Candidate]) -> Vec<u64> {
    c.iter().map(|c| c.len).collect()
}

fn sized(lens: &[u64]) -> Tree {
    let items = (0..lens.len())
        .map(|i| it(format!(r"f{i}.jpg")).size(lens[i]))
        .collect();
    build(r"D:\p", items)
}

/// The estimate of one tree with `query`.
fn guess(tree: &Tree, query: Option<&str>) -> Estimate {
    let known = win().known;
    let query = query.map(|q| Query::parse(q).unwrap());
    let opts = Options {
        query: query.as_ref(),
        now_ns: NOW_NS,
        ..opts(Os::Windows, &known)
    };
    estimate(&[root(tree)], &opts)
}

#[test]
fn only_files_of_4_kib_or_more_count() {
    let found = run(&[&sized(&[4095, 4096])], None);
    assert_eq!(lens(&found), [4096]);
}

#[test]
fn cloud_placeholders_are_left_out_but_second_links_stay() {
    let stub = build(r"D:\p", vec![it("a.jpg").size(0).len(5000)]);
    assert!(run(&[&stub], None).is_empty());
    let link = build(
        r"D:\p",
        vec![it("a.jpg").size(0).len(5000).flags(flags::HARDLINK)],
    );
    assert_eq!(lens(&run(&[&link], None)), [5000]);
}

#[test]
fn lossy_names_are_left_out() {
    let mut tree = build(r"D:\p", vec![file(r"bad\a.jpg"), file(r"good\b.jpg")]);
    let bad = tree.children(0).find(|&c| tree.name(c) == "bad").unwrap();
    tree.mark_lossy_for_test(bad);
    let found = run(&[&tree], None);
    let paths: Vec<_> = found
        .iter()
        .map(|c| node_path(&tree, c.node, Os::Windows))
        .collect();
    assert_eq!(paths, [r"D:\p\good\b.jpg"]);
}

#[test]
fn lengths_held_by_one_file_are_dropped() {
    let groups = buckets(run(&[&sized(&[5000, 5000, 6000])], None));
    assert_eq!(groups.len(), 1);
    assert_eq!(lens(&groups[0]), [5000, 5000]);
}

#[test]
fn seeds_pick_buckets_but_keep_every_copy() {
    let tree = build(
        r"D:\p",
        vec![
            file("IMG_1234.jpg").mtime(NOW_NS - 730 * DAY_NS),
            file("holiday.jpg").mtime(NOW_NS),
        ],
    );
    let groups = buckets(run(&[&tree], Some("holiday")));
    assert_eq!(groups.len(), 1);
    let seeds: Vec<_> = groups[0].iter().map(|c| c.seed).collect();
    // In node order: `IMG_1234.jpg` sorts before `holiday.jpg`.
    assert_eq!(seeds, [false, true]);
    assert_eq!(buckets(run(&[&tree], Some("older:1y"))).len(), 1);
    assert_eq!(buckets(run(&[&tree], Some("older:1y")))[0].len(), 2);
    assert!(buckets(run(&[&tree], Some("nomatch"))).is_empty());
    assert!(buckets(run(&[&tree], Some("type:video"))).is_empty());
}

#[test]
fn size_filter_cuts_by_length() {
    let pair = sized(&[5000, 5000]);
    assert!(buckets(run(&[&pair], Some(">1MB"))).is_empty());
    assert_eq!(buckets(run(&[&pair], Some("<1MB"))).len(), 1);
}

#[test]
fn a_folders_query_seeds_nothing() {
    let e = guess(&sized(&[5000, 5000]), Some("folders"));
    assert_eq!((e.files, e.eligible, e.seeded), (0, 2, 0));
}

#[test]
fn a_root_inside_another_is_skipped() {
    let outer = build(r"C:\data", vec![file("a.jpg"), file(r"sub\b.jpg")]);
    let inner = build(r"c:\DATA\sub", vec![file("b.jpg")]);
    let name = |trees: &[&Tree], c: &Candidate| trees[c.root as usize].name(c.node).to_owned();
    for trees in [[&outer, &inner], [&inner, &outer]] {
        let mut found: Vec<_> = run(&trees, None)
            .iter()
            .map(|c| (name(&trees, c), c.root))
            .collect();
        found.sort();
        let (a, b) = if std::ptr::eq(trees[0], &outer) {
            (0, 1)
        } else {
            (1, 0)
        };
        assert_eq!(found, [("a.jpg".to_owned(), a), ("b.jpg".to_owned(), b)]);
    }
}

#[test]
fn scanning_roots_are_left_out() {
    let tree = build(
        r"D:\p",
        vec![it(r"\").flags(flags::SCANNING), file("a.jpg")],
    );
    assert!(tree.node(0).has(flags::SCANNING));
    assert!(run(&[&tree], None).is_empty());
}

#[test]
fn estimate_counts_files_and_bytes_to_compare() {
    let e = guess(&sized(&[5000, 5000, 6000]), None);
    assert_eq!((e.files, e.bytes, e.eligible, e.seeded), (2, 10000, 3, 3));
}

#[test]
fn estimate_counts_seeds_without_a_pair() {
    let e = guess(&sized(&[5000, 6000]), None);
    assert_eq!((e.seeded, e.files), (2, 0));
}

#[test]
fn a_root_opened_twice_is_walked_once() {
    let one = build(r"C:\data", vec![file("a.jpg")]);
    let two = build(r"c:\Data", vec![file("a.jpg")]);
    let found = run(&[&one, &two], None);
    assert_eq!(found.iter().map(|c| c.root).collect::<Vec<_>>(), [0]);
}
