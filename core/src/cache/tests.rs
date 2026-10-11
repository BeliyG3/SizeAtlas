use std::fs;
use std::path::Path;

use super::*;
use crate::tree::{VolumeUsage, sample_tree};

fn saved(dir: &Path) -> (PathBuf, Tree) {
    let tree = sample_tree();
    let path = dir.join("scan.bin");
    save(&tree, &path).unwrap();
    (path, tree)
}

#[test]
fn fnv1a64_matches_reference_values() {
    assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
    assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
}

#[test]
fn cache_path_is_stable_hex_name() {
    let a = cache_path(Path::new("cache"), Path::new("/data/photos"));
    assert_eq!(a, cache_path(Path::new("cache"), Path::new("/data/photos")));
    let name = a.file_name().unwrap().to_str().unwrap();
    assert_eq!(name.len(), 16 + ".bin".len());
    assert!(name.ends_with(".bin"));
    assert_ne!(a, cache_path(Path::new("cache"), Path::new("/data/music")));
}

#[test]
fn round_trip_restores_the_tree_and_header() {
    let dir = tempfile::tempdir().unwrap();
    let (path, tree) = saved(dir.path());
    let (header, loaded) = load(&path).unwrap();
    assert_eq!(loaded, tree.compact_snapshot());
    assert_eq!(header, CacheHeader::of(&tree));
    assert_eq!(header.root, "/root");
    assert_eq!((header.total, header.files), (572, 4));
    assert!(!dir.path().join("scan.tmp").exists());
}

#[test]
fn header_is_readable_without_the_body() {
    let dir = tempfile::tempdir().unwrap();
    let (path, tree) = saved(dir.path());
    let bytes = fs::read(&path).unwrap();
    let header_len = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    fs::write(&path, &bytes[..12 + header_len]).unwrap();
    assert_eq!(read_header(&path).unwrap(), CacheHeader::of(&tree));
    assert!(matches!(load(&path), Err(CacheError::Invalid(_))));
}

fn write_raw(path: &Path, version: u32, header: &[u8]) {
    let mut bytes = b"SZAT".to_vec();
    bytes.extend_from_slice(&version.to_le_bytes());
    bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bytes.extend_from_slice(header);
    fs::write(path, bytes).unwrap();
}

#[test]
fn cache_of_another_version_reports_its_root() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("old.bin");
    // An older header: the root first, then fields this version does not read.
    let header = postcard::to_stdvec(&("C:\\old".to_owned(), 5i64, 7u64)).unwrap();
    for version in [1, 2] {
        write_raw(&path, version, &header);
        for result in [read_header(&path).map(|_| ()), load(&path).map(|_| ())] {
            match result {
                Err(CacheError::Outdated { root }) => assert_eq!(root, "C:\\old"),
                other => panic!("version {version}: expected Outdated, got {other:?}"),
            }
        }
    }
}

#[test]
fn unreadable_header_of_another_version_is_invalid() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("odd.bin");
    write_raw(&path, FORMAT_VERSION + 1, &[0xFF, 0xFF, 0xFF]);
    assert!(matches!(read_header(&path), Err(CacheError::Invalid(_))));
    assert!(matches!(load(&path), Err(CacheError::Invalid(_))));
}

#[test]
fn volume_usage_survives_a_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let mut tree = sample_tree();
    tree.volume = Some(VolumeUsage {
        total: 1 << 40,
        used: 1 << 39,
    });
    let path = dir.path().join("v.bin");
    save(&tree, &path).unwrap();
    let (header, loaded) = load(&path).unwrap();
    assert_eq!(loaded.volume, tree.volume);
    assert_eq!(header.volume, tree.volume);
}

#[test]
fn garbage_is_invalid_not_a_panic() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("junk.bin");
    fs::write(&path, b"definitely not a cache file").unwrap();
    assert!(matches!(load(&path), Err(CacheError::Invalid(_))));
    fs::write(&path, b"SZ").unwrap();
    assert!(matches!(read_header(&path), Err(CacheError::Invalid(_))));
}

#[test]
fn decodable_tree_with_broken_indices_is_invalid() {
    let dir = tempfile::tempdir().unwrap();
    let mut tree = sample_tree();
    tree.nodes_mut_for_test()[0].child_count = 999;
    let path = dir.path().join("broken.bin");
    write_file(&path, &CacheHeader::of(&tree), &tree).unwrap();
    assert!(matches!(load(&path), Err(CacheError::Invalid(_))));
}

#[test]
fn missing_file_is_io_error() {
    let dir = tempfile::tempdir().unwrap();
    assert!(matches!(
        load(&dir.path().join("none.bin")),
        Err(CacheError::Io(_))
    ));
}

fn prefix_claiming(header_len: u32) -> Vec<u8> {
    let mut bytes = MAGIC.to_vec();
    bytes.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    bytes.extend_from_slice(&header_len.to_le_bytes());
    bytes
}

#[test]
fn absurd_header_length_is_invalid_without_allocating() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("huge.bin");
    fs::write(&path, prefix_claiming(u32::MAX)).unwrap();
    assert!(matches!(read_header(&path), Err(CacheError::Invalid(_))));
    assert!(matches!(load(&path), Err(CacheError::Invalid(_))));
}

#[test]
fn header_just_above_the_cap_is_invalid_even_when_present() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.bin");
    let mut bytes = prefix_claiming(MAX_HEADER_LEN as u32 + 1);
    bytes.resize(PREFIX_LEN + MAX_HEADER_LEN + 1, 0);
    fs::write(&path, bytes).unwrap();
    assert!(matches!(read_header(&path), Err(CacheError::Invalid(_))));
    assert!(matches!(load(&path), Err(CacheError::Invalid(_))));
}

#[test]
fn tree_with_dead_nodes_is_saved_as_it_is() {
    let dir = tempfile::tempdir().unwrap();
    let mut tree = sample_tree();
    let docs = tree.children(0).find(|&c| tree.name(c) == "docs").unwrap();
    tree.remove(docs);
    let path = dir.path().join("scan.bin");
    save(&tree, &path).unwrap();
    let (header, loaded) = load(&path).unwrap();
    assert_eq!(loaded, tree, "no copy: dead nodes are saved too");
    assert!(loaded.dead > 0);
    assert_eq!(header, CacheHeader::of(&loaded));
    loaded.check_structure().unwrap();
}
