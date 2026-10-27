//! The walk of the candidates split into parallel tasks finds what one task finds.

use super::candidates::{Candidate, buckets, collect, collect_split};
use super::tests_zones::{opts, root};
use super::*;
use crate::cleanup::paths::node_path;
use crate::cleanup::tests::{Item, build, it, win};
use crate::tree::Query;

/// Thirty folders under `top` with files of a few lengths, some too short.
fn folders(items: &mut Vec<Item>, top: &str, a: u64) {
    for b in 0..30 {
        for f in 0..4 {
            let len = 3000 + (a * 7 + b * 3 + f) % 6 * 1000;
            items.push(it(format!(r"{top}\d{b}\f{f}.jpg")).size(len));
            items.push(it(format!(r"{top}\d{b}\deep\g{f}.png")).size(len + 1));
        }
    }
}

/// Several hundred folders, with zones (the system folder, packages) and a Python environment
/// among them, and a lossy-named folder inside one big enough to be split off.
fn generated() -> Tree {
    let mut items = Vec::new();
    for a in 0..12 {
        let top = match a {
            0 => "Windows".to_owned(),
            1 => r"work\node_modules".to_owned(),
            2 => {
                items.push(it(r"py\env\pyvenv.cfg"));
                r"py\env".to_owned()
            }
            _ => format!("u{a}"),
        };
        folders(&mut items, &top, a);
    }
    let mut tree = build(r"D:\", items);
    let u8 = tree.children(0).find(|&c| tree.name(c) == "u8").unwrap();
    let lossy = tree.children(u8).find(|&c| tree.name(c) == "d3").unwrap();
    tree.mark_lossy_for_test(lossy);
    tree
}

/// A root opened inside the generated one, at `u7\d3`: below a folder split off as a task.
fn inner() -> Tree {
    let mut items = Vec::new();
    folders(&mut items, "w", 7);
    build(r"D:\u7\d3", items)
}

/// Whether `c` is in the generated tree (root 0) under `dir`.
fn under(tree: &Tree, c: &Candidate, dir: &str) -> bool {
    c.root == 0 && node_path(tree, c.node, Os::Windows).starts_with(dir)
}

/// The candidates in `(root, node)` order, and the eligible count.
fn sorted((mut found, eligible): (Vec<Candidate>, u64)) -> (Vec<Candidate>, u64) {
    found.sort_unstable_by_key(|c| (c.root, c.node));
    (found, eligible)
}

#[test]
fn the_parallel_walk_finds_what_one_walk_finds() {
    let known = win().known;
    let (tree, inner) = (generated(), inner());
    let opts = opts(Os::Windows, &known);
    let u5 = tree.children(0).find(|&c| tree.name(c) == "u5").unwrap();
    let scoped = SearchRoot {
        start: u5,
        ..root(&tree)
    };
    for roots in [[root(&tree), root(&inner)], [scoped, root(&inner)]] {
        let one = collect_split(&roots, &opts, u32::MAX);
        assert!(one.0.iter().any(|c| c.protected) == (roots[0].start == 0));
        assert!(one.0.iter().any(|c| !c.protected));
        // The inner root is walked on its own; the outer walk leaves it and the lossy name out.
        assert!(one.0.iter().any(|c| c.root == 1));
        let left_out =
            |c: &Candidate| under(&tree, c, r"D:\u7\d3\") || under(&tree, c, r"D:\u8\d3\");
        assert!(!one.0.iter().any(left_out));
        for split in [1, 40] {
            let many = collect_split(&roots, &opts, split);
            assert_eq!(sorted(many.clone()), sorted(one.clone()), "split {split}");
            assert_eq!(buckets(many.0), buckets(one.0.clone()), "split {split}");
        }
        assert_eq!(sorted(collect(&roots, &opts)), sorted(one));
    }
}

#[test]
fn the_estimate_counts_the_buckets_of_one_walk() {
    let known = win().known;
    let tree = generated();
    let query = Query::parse("*.png").unwrap();
    let opts = Options {
        query: Some(&query),
        ..opts(Os::Windows, &known)
    };
    let roots = [root(&tree)];
    let (found, eligible) = collect_split(&roots, &opts, u32::MAX);
    let groups = buckets(found.clone());
    let want = Estimate {
        files: groups.iter().map(Vec::len).sum::<usize>() as u64,
        bytes: groups.iter().flatten().map(|c| c.len).sum(),
        eligible,
        seeded: found.iter().filter(|c| c.seed).count() as u64,
    };
    assert!(want.files > 0 && want.seeded < found.len() as u64);
    assert_eq!(estimate(&roots, &opts), want);
}
