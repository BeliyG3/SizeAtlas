//! Files that changed, went away or are in the cloud after the scan: left out and counted,
//! never a false group.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::AtomicBool;

use super::tests::*;

#[test]
fn a_file_changed_after_the_scan_is_left_out() {
    let d = dir();
    put(d.path(), "a", &data(5000));
    let b = put(d.path(), "b", &data(5000));
    let tree = scan_of(d.path());
    rewrite(&b, &data(5000));
    let (groups, out, _) = run(&[&tree], "", &cache());
    assert!(groups.is_empty());
    assert_eq!(out.unread.changed, 1);
}

#[test]
fn a_file_gone_after_the_scan_is_counted_unread() {
    let d = dir();
    put(d.path(), "a", &data(5000));
    let b = put(d.path(), "b", &data(5000));
    put(d.path(), "c", &data(6000));
    put(d.path(), "d", &data(6000));
    let tree = scan_of(d.path());
    fs::remove_file(b).unwrap();
    let (groups, out, _) = run(&[&tree], "", &cache());
    assert_eq!(out.unread.changed, 1);
    assert_eq!(all_names(&groups), [["c", "d"]]);
    assert!(out.complete);
}

/// Grows the file `b` by a byte: a change between its read and the check after it.
fn grow_b(path: &Path) {
    if path.file_name().is_some_and(|n| n == "b") {
        let mut file = OpenOptions::new().append(true).open(path).unwrap();
        file.write_all(b"x").unwrap();
    }
}

#[test]
fn a_short_file_changed_while_read_is_left_out() {
    let d = dir();
    put(d.path(), "a", &data(10_000));
    put(d.path(), "b", &data(10_000));
    let mut p = prepared(&[&scan_of(d.path())], "");
    p.after_read = Some(grow_b);
    let cache = cache();
    let (groups, out, _) = finish(p, &cache, &AtomicBool::new(false), false);
    assert!(groups.is_empty());
    assert_eq!(out.unread.changed, 1);
    assert_eq!(cache.lock().unwrap().len(), 1, "only a is cached");
}

/// Once `a` is read, puts another file with the same bytes, length and time in place of `b`.
fn swap_b(path: &Path) {
    if path.file_name().is_some_and(|n| n == "a") {
        let b = path.with_file_name("b");
        let new = path.with_file_name("b.new");
        fs::write(&new, fs::read(&b).unwrap()).unwrap();
        let time = fs::metadata(&b).unwrap().modified().unwrap();
        fs::File::options()
            .write(true)
            .open(&new)
            .unwrap()
            .set_modified(time)
            .unwrap();
        fs::rename(&new, &b).unwrap();
        settle(&b);
    }
}

#[test]
fn a_file_replaced_after_its_identity_was_read_is_left_out() {
    let d = dir();
    put(d.path(), "a", &data(5000));
    put(d.path(), "b", &data(5000));
    let mut p = prepared(&[&scan_of(d.path())], "");
    p.after_read = Some(swap_b);
    let (groups, out, _) = finish(p, &cache(), &AtomicBool::new(false), false);
    assert!(groups.is_empty());
    assert_eq!(out.unread.changed, 1);
}

#[cfg(windows)]
#[test]
fn an_offline_file_is_never_opened() {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_OFFLINE, SetFileAttributesW};

    let d = dir();
    put(d.path(), "a", &data(5000));
    let b = put(d.path(), "b", &data(5000));
    let tree = scan_of(d.path());
    let wide: Vec<u16> = b.as_os_str().encode_wide().chain([0]).collect();
    // SAFETY: `wide` is a NUL-terminated path that lives through the call.
    assert_ne!(
        unsafe { SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_OFFLINE) },
        0
    );
    let (groups, out, _) = run(&[&tree], "", &cache());
    assert!(groups.is_empty());
    assert_eq!(out.unread.cloud, 1);
    assert_eq!(out.stats.opened, 1);
}
