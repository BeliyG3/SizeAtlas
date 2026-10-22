use super::*;
use crate::tree::{DirRec, FileRec, ListKind, NO_PARENT, ScanMeta, SizeMode};

const META: ScanMeta = ScanMeta {
    cluster: 0,
    size_mode: SizeMode::Logical,
    scanned_at: 0,
};

fn q(text: &str) -> Query {
    Query::parse(text).unwrap()
}

fn hit(query: &str, name: &str) -> bool {
    q(query).matches(name, false)
}

#[test]
fn parse_splits_words_extensions_and_masks() {
    assert!(Query::parse("").is_none());
    assert!(Query::parse("  \t ").is_none());
    let query = q("IMG .jpg *.png");
    assert_eq!(query.words.len(), 1);
    assert_eq!(query.alternatives.len(), 2);
    assert!(matches!(query.alternatives[0], Alternative::Extension(_)));
    assert!(matches!(query.alternatives[1], Alternative::Mask(_)));
}

#[test]
fn a_word_is_a_substring_in_any_case() {
    assert!(hit("backup", "Old_BACKUP.zip"));
    assert!(!hit("backup", "Old_BACKU.zip"));
    assert!(hit("ФОТО", "фото_2024.jpg"));
    assert!(hit("фото", "Мои_ФОТО.jpg"));
    assert!(!hit("фото", "photo.jpg"));
    // Every word has to be there.
    assert!(hit("old zip", "Old_backup.zip"));
    assert!(!hit("old rar", "Old_backup.zip"));
}

#[test]
fn an_extension_matches_files_only_by_the_end_of_the_name() {
    assert!(hit(".JPG", "a.jpg"));
    assert!(!q(".JPG").matches("a.jpg", true));
    assert!(!q(".git").matches(".git", true));
    assert!(q(".git").matches(".git", false));
    assert!(hit(".tar.gz", "x.tar.gz"));
    assert!(!hit(".gz", "x.gz.txt"));
    assert!(hit(".ЖПГ", "а.жпг"));
}

#[test]
fn a_mask_covers_the_whole_name_of_files_and_folders() {
    assert!(hit("IMG_*", "img_001.png"));
    assert!(!hit("IMG_*", "xIMG_1"));
    assert!(q("IMG_*").matches("img_dir", true));
    assert!(hit("?.txt", "a.txt"));
    assert!(!hit("?.txt", "ab.txt"));
    assert!(!hit("?.txt", ".txt"));
    assert!(hit("*a*b*", "aXbYb"));
    assert!(hit("*a*b", "aXbYb"));
    assert!(!hit("*a*b*", "bXa"));
    assert!(hit("*", "anything"));
    assert!(hit("ф?то*", "ФОТО_1"));
    assert!(!hit("ф?то*", "фто"));
}

#[test]
fn words_and_extensions_combine_as_and_or() {
    assert!(hit("IMG .jpg .png", "IMG_1.png"));
    assert!(!hit("IMG .jpg .png", "IMG_1.gif"));
    assert!(!hit("IMG .jpg .png", "x.png"));
    assert!(hit(".mp4 *.mkv", "a.mkv"));
    assert!(hit(".mp4 *.mkv", "a.mp4"));
}

fn file(name: &str, size: u64) -> FileRec {
    FileRec {
        name: name.into(),
        size,
        len: size,
        mtime: 1,
        flags: 0,
        ino: None,
    }
}

fn dir(id: u32, parent: u32, name: &str, files: Vec<FileRec>) -> DirRec {
    DirRec {
        id,
        parent,
        name: name.into(),
        mtime: 1,
        flags: 0,
        files,
    }
}

/// ```text
/// /r
///   backup          backup.zip 100, x.bin 50
///   other           backup.old 30
/// ```
fn tree() -> Tree {
    Tree::from_records(
        vec![
            dir(0, NO_PARENT, "/r", vec![]),
            dir(
                1,
                0,
                "backup",
                vec![file("backup.zip", 100), file("x.bin", 50)],
            ),
            dir(2, 0, "other", vec![file("backup.old", 30)]),
        ],
        META,
    )
}

fn id_of(tree: &Tree, name: &str) -> u32 {
    (0..tree.len() as u32)
        .find(|&id| tree.name(id) == name)
        .unwrap()
}

fn names(tree: &Tree, found: &Found) -> Vec<String> {
    found
        .items
        .iter()
        .map(|&i| tree.name(i).to_owned())
        .collect()
}

#[test]
fn a_folder_and_what_is_inside_it_are_counted_but_sized_once() {
    let tree = tree();
    let found = tree.search(0, &q("backup"), 10);
    assert_eq!(found.count, 3);
    assert!(!found.truncated);
    let folder = tree.node(id_of(&tree, "backup")).size;
    assert_eq!(folder, 150);
    assert_eq!(found.size, folder + 30);
    assert_eq!(names(&tree, &found), ["backup", "backup.zip", "backup.old"]);
}

#[test]
fn the_limit_keeps_the_largest_and_reports_the_rest() {
    let tree = tree();
    let found = tree.search(0, &q("backup"), 1);
    assert!(found.truncated);
    assert_eq!(names(&tree, &found), ["backup"]);
    // The totals still cover every match.
    assert_eq!((found.count, found.size), (3, 180));
    assert!(tree.search(0, &q("backup"), 0).items.is_empty());
}

#[test]
fn the_searched_folder_itself_is_never_found() {
    let tree = tree();
    assert_eq!(tree.search(0, &q("/r"), 10).count, 0);
    let backup = id_of(&tree, "backup");
    let found = tree.search(backup, &q("backup"), 10);
    assert_eq!(names(&tree, &found), ["backup.zip"]);
    // Nothing above the folder is searched, and a match inside it is not covered by itself.
    assert_eq!((found.count, found.size), (1, 100));
}

#[test]
fn dead_nodes_are_not_found() {
    let mut tree = tree();
    let zip = id_of(&tree, "backup.zip");
    tree.remove(zip);
    let found = tree.search(0, &q("backup"), 10);
    assert_eq!(found.count, 2);
    assert_eq!(names(&tree, &found), ["backup", "backup.old"]);
    let other = id_of(&tree, "other");
    tree.remove(other);
    assert_eq!(tree.search(0, &q("backup"), 10).count, 1);
}

#[test]
fn extensions_skip_folders_in_a_tree_search() {
    let tree = tree();
    let found = tree.search(0, &q(".old .bin"), 10);
    assert_eq!(names(&tree, &found), ["x.bin", "backup.old"]);
    assert_eq!(found.size, 80);
}

#[test]
fn search_is_not_a_list_kind_of_the_tree() {
    let tree = tree();
    assert!(tree.list(0, ListKind::Search, 10).items.is_empty());
}
