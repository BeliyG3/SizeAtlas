use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use super::hash::{Skip, rehash};
use super::held::rehash_held;
use crate::scanner::mtime_of;

/// A temporary folder outside `%TEMP%`, which lies in a protected zone on Windows.
fn temp() -> tempfile::TempDir {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/test-tmp");
    fs::create_dir_all(&base).unwrap();
    tempfile::Builder::new().tempdir_in(base).unwrap()
}

fn write(dir: &Path, name: &str, len: usize) -> (PathBuf, u64, i64) {
    let path = dir.join(name);
    let bytes: Vec<u8> = (0..len).map(|i| (i * 7 + i / 4096) as u8).collect();
    fs::write(&path, bytes).unwrap();
    let mtime = mtime_of(&fs::symlink_metadata(&path).unwrap());
    (path, len as u64, mtime)
}

#[test]
fn rehash_held_gives_the_hash_of_rehash() {
    let dir = temp();
    let (path, len, mtime) = write(dir.path(), "a", 3 << 20);
    let (hash, id) = rehash(&path, len, mtime, &|| false, &mut |_| {}).unwrap();
    let (held_hash, held) = rehash_held(&path, len, mtime, &|| false, &mut |_| {}).unwrap();
    assert_eq!(held_hash, hash);
    assert_eq!(held.identity(), id);
    assert!(held.unchanged(&path));
}

#[test]
fn rehash_held_stops_before_the_first_buffer() {
    let dir = temp();
    let (path, len, mtime) = write(dir.path(), "a", 3 << 20);
    let mut read = 0;
    let got = rehash_held(&path, len, mtime, &|| true, &mut |n| read += n).map(|_| ());
    assert_eq!(got, Err(Skip::Failed));
    assert_eq!(read, 0, "nothing was read");
}

#[cfg(windows)]
#[test]
fn a_held_file_cannot_be_written_renamed_or_deleted() {
    let dir = temp();
    let (path, len, mtime) = write(dir.path(), "a", 20_000);
    let moved = dir.path().join("moved");
    let (_, held) = rehash_held(&path, len, mtime, &|| false, &mut |_| {}).unwrap();
    assert!(OpenOptions::new().write(true).open(&path).is_err());
    assert!(fs::rename(&path, &moved).is_err());
    assert!(fs::remove_file(&path).is_err());
    assert!(held.unchanged(&path));
    drop(held);
    assert!(OpenOptions::new().write(true).open(&path).is_ok());
    fs::rename(&path, &moved).unwrap();
    fs::remove_file(&moved).unwrap();
}

#[cfg(windows)]
#[test]
fn a_file_open_for_writing_cannot_be_held() {
    let dir = temp();
    let (path, len, mtime) = write(dir.path(), "a", 20_000);
    let writer = OpenOptions::new().write(true).open(&path).unwrap();
    let got = rehash_held(&path, len, mtime, &|| false, &mut |_| {}).map(|_| ());
    assert_eq!(got, Err(Skip::Changed));
    drop(writer);
    assert!(rehash_held(&path, len, mtime, &|| false, &mut |_| {}).is_ok());
}

#[cfg(unix)]
#[test]
fn unchanged_sees_a_rewrite_and_a_replacement() {
    use std::io::Write;
    let dir = temp();
    let (path, len, mtime) = write(dir.path(), "a", 20_000);
    let (_, held) = rehash_held(&path, len, mtime, &|| false, &mut |_| {}).unwrap();
    assert!(held.unchanged(&path));
    OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"more")
        .unwrap();
    assert!(!held.unchanged(&path), "a rewrite");

    let (path, len, mtime) = write(dir.path(), "b", 20_000);
    let (_, held) = rehash_held(&path, len, mtime, &|| false, &mut |_| {}).unwrap();
    let (other, _, _) = write(dir.path(), "c", 20_000);
    fs::rename(&other, &path).unwrap();
    assert!(!held.unchanged(&path), "another file of the same name");
}
