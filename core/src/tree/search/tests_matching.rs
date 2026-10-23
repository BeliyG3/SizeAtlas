//! Conditions on a built tree: sizes, dates, types and folders.

use super::*;
use crate::tree::{DirRec, FileRec, NO_PARENT, ScanMeta, SizeMode};

const META: ScanMeta = ScanMeta {
    cluster: 0,
    size_mode: SizeMode::Logical,
    scanned_at: 0,
};
const KB: u64 = 1 << 10;
const MB: u64 = 1 << 20;
const GB: u64 = 1 << 30;
const DAY: i64 = 86_400_000_000_000;
/// The fixed "now" of the tests, far from 0 so that ages can be written as days.
const NOW: i64 = 10_000 * DAY;

fn q(text: &str) -> Query {
    Query::parse(text).unwrap()
}

fn file(name: &str, size: u64, age_days: Option<i64>) -> FileRec {
    FileRec {
        name: name.into(),
        size,
        len: size,
        mtime: age_days.map_or(0, |d| NOW - d * DAY),
        flags: 0,
        ino: None,
    }
}

fn dir(id: u32, parent: u32, name: &str, age_days: i64, files: Vec<FileRec>) -> DirRec {
    DirRec {
        id,
        parent,
        name: name.into(),
        mtime: NOW - age_days * DAY,
        flags: 0,
        files,
    }
}

/// ```text
/// /r
///   vids  (3 days)    holiday.mp4 2 GiB 800 d, clip.mp4 500 MiB 10 d, raw.mkv 2 GiB ?
///     deep (400 days) old.avi 1 GiB 400 d
///   docs  (1 day)     report.pdf 1 MiB 5 d, backup.zip 1 GiB 5 d, holiday.txt 1 KiB 40 d
/// ```
fn tree() -> Tree {
    Tree::from_records(
        vec![
            dir(0, NO_PARENT, "/r", 0, vec![]),
            dir(
                1,
                0,
                "vids",
                3,
                vec![
                    file("holiday.mp4", 2 * GB, Some(800)),
                    file("clip.mp4", 500 * MB, Some(10)),
                    file("raw.mkv", 2 * GB, None),
                ],
            ),
            dir(2, 0, "docs", 1, {
                vec![
                    file("report.pdf", MB, Some(5)),
                    file("backup.zip", GB, Some(5)),
                    file("holiday.txt", KB, Some(40)),
                ]
            }),
            dir(3, 1, "deep", 400, vec![file("old.avi", GB, Some(400))]),
        ],
        META,
    )
}

fn found(tree: &Tree, text: &str) -> Vec<String> {
    let result = tree.search(0, &q(text), 100, NOW);
    let mut names: Vec<String> = result.items.iter().map(|&i| tree.name(i).into()).collect();
    names.sort();
    names
}

#[test]
fn size_is_on_disk_and_the_bounds_are_exact() {
    let tree = tree();
    assert_eq!(found(&tree, "files >1GB"), ["holiday.mp4", "raw.mkv"]);
    assert_eq!(
        found(&tree, "files >=1GB"),
        ["backup.zip", "holiday.mp4", "old.avi", "raw.mkv"]
    );
    assert_eq!(found(&tree, "files <1MB"), ["holiday.txt"]);
    assert_eq!(found(&tree, "files <=1MB"), ["holiday.txt", "report.pdf"]);
    assert_eq!(
        found(&tree, "files 1MB..1GB"),
        ["backup.zip", "clip.mp4", "old.avi", "report.pdf"]
    );
    assert_eq!(found(&tree, "files 1024KB..1024MB").len(), 4);
}

#[test]
fn a_folder_has_the_size_of_its_subtree() {
    let tree = tree();
    // vids holds 2 GiB + 500 MiB + 2 GiB + deep's 1 GiB.
    assert_eq!(found(&tree, "folders >5GB"), ["vids"]);
    assert_eq!(found(&tree, "folders >1GB"), ["docs", "vids"]);
    assert_eq!(found(&tree, "folders <1GB"), Vec::<String>::new());
    assert_eq!(found(&tree, "folders <2GB"), ["deep", "docs"]);
    assert_eq!(found(&tree, ">=1GB folders"), ["deep", "docs", "vids"]);
}

#[test]
fn dates_count_back_from_the_given_now() {
    let tree = tree();
    assert_eq!(found(&tree, "files older:1y"), ["holiday.mp4", "old.avi"]);
    assert_eq!(found(&tree, "files older:400d"), ["holiday.mp4", "old.avi"]);
    assert_eq!(found(&tree, "files older:401d"), ["holiday.mp4"]);
    assert_eq!(
        found(&tree, "files newer:10d"),
        ["backup.zip", "clip.mp4", "report.pdf"]
    );
    assert_eq!(found(&tree, "files newer:9d").len(), 2);
    assert_eq!(
        found(&tree, "files older:1m newer:2y"),
        ["holiday.txt", "old.avi"]
    );
    // A folder has its own time: deep is 400 days old.
    assert_eq!(found(&tree, "folders older:1y"), ["deep"]);
    assert_eq!(found(&tree, "folders newer:3d"), ["docs", "vids"]);
    // Another now moves everything.
    let later = tree.search(0, &q("files newer:10d"), 100, NOW + 100 * DAY);
    assert_eq!(later.count, 0);
}

#[test]
fn an_unknown_time_passes_neither_older_nor_newer() {
    let tree = tree();
    let all = found(&tree, "raw.mkv");
    assert_eq!(all, ["raw.mkv"]);
    assert!(found(&tree, "raw.mkv older:0d").is_empty());
    assert!(found(&tree, "raw.mkv newer:100y").is_empty());
    assert!(!found(&tree, "files older:1d").contains(&"raw.mkv".into()));
    assert!(!found(&tree, "files newer:100y").contains(&"raw.mkv".into()));
}

#[test]
fn a_time_after_now_is_new_not_old() {
    let tree = tree();
    let before = tree.search(0, &q("holiday.txt newer:1d"), 10, NOW - 100 * DAY);
    assert_eq!(before.count, 1);
    let before = tree.search(0, &q("holiday.txt older:1d"), 10, NOW - 100 * DAY);
    assert_eq!(before.count, 0);
}

#[test]
fn types_match_files_of_the_category_and_never_folders() {
    let tree = tree();
    assert_eq!(
        found(&tree, "type:video"),
        ["clip.mp4", "holiday.mp4", "old.avi", "raw.mkv"]
    );
    assert_eq!(found(&tree, "type:document"), ["holiday.txt", "report.pdf"]);
    assert_eq!(
        found(&tree, "type:archive type:document"),
        ["backup.zip", "holiday.txt", "report.pdf"]
    );
    assert!(found(&tree, "type:other").is_empty());
    assert!(found(&tree, "type:video folders").is_empty());
}

#[test]
fn conditions_name_words_and_extensions_work_together() {
    let tree = tree();
    assert_eq!(found(&tree, "holiday type:video >1GB"), ["holiday.mp4"]);
    assert_eq!(found(&tree, "holiday older:1y"), ["holiday.mp4"]);
    assert_eq!(
        found(&tree, "holiday .mp4 .txt"),
        ["holiday.mp4", "holiday.txt"]
    );
    assert_eq!(found(&tree, "holiday .mp4 .txt >1MB"), ["holiday.mp4"]);
    assert_eq!(found(&tree, "*.mp4 type:video <1GB"), ["clip.mp4"]);
    assert_eq!(found(&tree, "type:video >1GB older:1y"), ["holiday.mp4"]);
    // An invalid word is part of the name, so nothing is named so.
    assert!(found(&tree, "holiday >abc").is_empty());
    assert_eq!(found(&tree, "holiday type:foo").len(), 0);
}

#[test]
fn totals_count_a_matching_folder_once() {
    let tree = tree();
    let result = tree.search(0, &q("folders >=1GB"), 100, NOW);
    // deep is inside vids: counted, not added to the size twice.
    assert_eq!(result.count, 3);
    let size = |name: &str| {
        tree.node(
            (0..tree.len() as u32)
                .find(|&i| tree.name(i) == name)
                .unwrap(),
        )
        .size
    };
    assert_eq!(result.size, size("vids") + size("docs"));
    // The conditions alone, over files: all counted and summed.
    let result = tree.search(0, &q("files >=1GB"), 100, NOW);
    assert_eq!((result.count, result.size), (4, 6 * GB));
}

#[test]
fn the_limit_applies_after_the_conditions() {
    let tree = tree();
    let result = tree.search(0, &q("type:video"), 1, NOW);
    assert!(result.truncated);
    assert_eq!(result.count, 4);
    assert_eq!(result.items.len(), 1);
}
