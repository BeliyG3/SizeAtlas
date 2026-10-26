use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::AtomicBool;

use super::hash::{PREFIX, Skip, full, open_checked, prefix, rehash, tail, verify_after};
use crate::platform::{identity, open_for_hash};
use crate::scanner::mtime_of;

/// A temporary folder outside `%TEMP%`, which lies in a protected zone on Windows.
fn temp() -> tempfile::TempDir {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/test-tmp");
    fs::create_dir_all(&base).unwrap();
    tempfile::Builder::new().tempdir_in(base).unwrap()
}

/// Bytes that differ along the file, so a hash of the wrong range does not match.
fn data(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i * 7 + i / 4096) as u8).collect()
}

fn write(dir: &Path, name: &str, bytes: &[u8]) -> (std::path::PathBuf, i64) {
    let path = dir.join(name);
    fs::write(&path, bytes).unwrap();
    let mtime = mtime_of(&fs::symlink_metadata(&path).unwrap());
    (path, mtime)
}

fn blake(bytes: &[u8]) -> [u8; 32] {
    *blake3::hash(bytes).as_bytes()
}

#[test]
fn a_short_file_has_its_prefix_as_full_hash() {
    let dir = temp();
    for len in [10_000, 16_384] {
        let bytes = data(len);
        let (path, _) = write(dir.path(), "a", &bytes);
        let got = prefix(&mut File::open(&path).unwrap(), len as u64).unwrap();
        assert_eq!(got, (blake(&bytes), Some(blake(&bytes))), "{len}");
    }
    let bytes = data(20_000);
    let (path, _) = write(dir.path(), "b", &bytes);
    let got = prefix(&mut File::open(&path).unwrap(), 20_000).unwrap();
    assert_eq!(got, (blake(&bytes[..PREFIX]), None));
}

#[test]
fn tail_hashes_the_last_16_kib() {
    let dir = temp();
    let bytes = data(3 << 20);
    let (path, _) = write(dir.path(), "a", &bytes);
    let len = bytes.len();
    let got = tail(&mut File::open(&path).unwrap(), len as u64).unwrap();
    assert_eq!(got, blake(&bytes[len - 16_384..]));
}

#[test]
fn full_hash_reads_from_the_start() {
    let dir = temp();
    let bytes = data(3 << 20);
    let (path, _) = write(dir.path(), "a", &bytes);
    let mut file = File::open(&path).unwrap();
    // A prefix read first leaves the position past the start.
    prefix(&mut file, bytes.len() as u64).unwrap();
    let mut read = 0;
    let got = full(&mut file, &AtomicBool::new(false), &mut |n| read += n).unwrap();
    assert_eq!(got, Some(blake(&bytes)));
    assert_eq!(read, bytes.len() as u64, "progress counts every byte");
}

#[test]
fn full_hash_stops_on_cancel() {
    let dir = temp();
    let (path, _) = write(dir.path(), "a", &data(3 << 20));
    let mut file = File::open(&path).unwrap();
    let got = full(&mut file, &AtomicBool::new(true), &mut |_| {}).unwrap();
    assert_eq!(got, None);
}

#[test]
fn verify_after_sees_a_file_that_grew() {
    let dir = temp();
    let bytes = data(20_000);
    let (path, mtime) = write(dir.path(), "a", &bytes);
    let (file, _, stamp) = open_checked(&path, bytes.len() as u64, mtime).unwrap();
    assert_eq!(verify_after(&file, stamp), Ok(()));
    let mut other = OpenOptions::new().append(true).open(&path).unwrap();
    other.write_all(b"more").unwrap();
    other.sync_all().unwrap();
    assert_eq!(verify_after(&file, stamp), Err(Skip::Changed));
}

#[test]
fn open_checked_refuses_a_changed_or_missing_file() {
    let dir = temp();
    let (path, mtime) = write(dir.path(), "a", &data(20_000));
    assert!(open_checked(&path, 20_000, mtime).is_ok());
    let changed = open_checked(&path, 20_000, mtime - 1_000_000_000).map(|_| ());
    assert_eq!(changed, Err(Skip::Changed), "another time");
    let longer = open_checked(&path, 20_001, mtime).map(|_| ());
    assert_eq!(longer, Err(Skip::Changed), "another length");
    fs::remove_file(&path).unwrap();
    let gone = open_checked(&path, 20_000, mtime).map(|_| ());
    assert_eq!(gone, Err(Skip::Changed), "deleted");
}

#[test]
fn open_checked_refuses_a_link_and_a_folder() {
    let dir = temp();
    let (target, mtime) = write(dir.path(), "a", &data(20_000));
    let folder = dir.path().join("folder");
    fs::create_dir(&folder).unwrap();
    assert_eq!(open_checked(&folder, 0, 0).map(|_| ()), Err(Skip::Failed));
    let link = dir.path().join("link");
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&target, &link).is_ok();
    // Windows needs Developer Mode or elevation for a symbolic link.
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_file(&target, &link).is_ok();
    if made {
        let got = open_checked(&link, 20_000, mtime).map(|_| ());
        assert_eq!(got, Err(Skip::Failed));
    }
}

#[test]
fn two_links_have_one_id_and_two_links() {
    let dir = temp();
    let bytes = data(20_000);
    let (a, _) = write(dir.path(), "a", &bytes);
    let b = dir.path().join("b");
    fs::hard_link(&a, &b).unwrap();
    let (copy, _) = write(dir.path(), "copy", &bytes);
    let of = |path: &Path| identity(&open_for_hash(path).unwrap());
    let (ia, ib, ic) = (of(&a), of(&b), of(&copy));
    assert!(ia.id.is_some());
    assert_eq!(ia.id, ib.id);
    assert_eq!((ia.nlink, ib.nlink), (2, 2));
    assert_ne!(ic.id, ia.id, "an independent copy");
    assert_eq!(ic.nlink, 1);
}

#[test]
fn rehash_hashes_the_whole_file_unless_stopped() {
    let dir = temp();
    let bytes = data(3 << 20);
    let (path, mtime) = write(dir.path(), "a", &bytes);
    let len = bytes.len() as u64;
    let (hash, id) = rehash(&path, len, mtime, &|| false, &mut |_| {}).unwrap();
    assert_eq!(hash, blake(&bytes));
    assert_eq!(id, identity(&open_for_hash(&path).unwrap()));
    let stopped = rehash(&path, len, mtime, &|| true, &mut |_| {}).map(|_| ());
    assert_eq!(stopped, Err(Skip::Failed));
}

#[cfg(windows)]
#[test]
fn open_checked_cannot_read_a_file_held_by_another_program() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = temp();
    let (path, mtime) = write(dir.path(), "a", &data(20_000));
    let held = OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    let got = open_checked(&path, 20_000, mtime).map(|_| ());
    assert_eq!(got, Err(Skip::NoAccess));
    drop(held);
    assert!(open_checked(&path, 20_000, mtime).is_ok());
}
