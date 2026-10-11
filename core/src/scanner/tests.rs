use std::fs;
use std::path::Path;

use super::*;
use crate::categories::Category;

fn scan_ok(root: &Path) -> Tree {
    match scan(root, &AtomicBool::new(false), &Progress::default()).expect("scan succeeds") {
        ScanOutcome::Done(tree) => tree,
        ScanOutcome::Cancelled => panic!("scan was not cancelled"),
    }
}

fn find(tree: &Tree, path: &[&str]) -> u32 {
    path.iter().fold(0, |id, name| {
        tree.children(id)
            .find(|&c| tree.name(c) == *name)
            .unwrap_or_else(|| panic!("{name} not found"))
    })
}

fn expected_disk_size(tree: &Tree, path: &Path) -> u64 {
    let meta = fs::symlink_metadata(path).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let _ = tree;
        meta.blocks() * 512
    }
    #[cfg(windows)]
    {
        if tree.cluster == 0 {
            meta.len()
        } else {
            meta.len().div_ceil(tree.cluster) * tree.cluster
        }
    }
}

#[test]
fn sums_sizes_counts_and_categories() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.txt"), vec![0u8; 10]).unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub").join("b.mp4"), vec![0u8; 5000]).unwrap();

    let tree = scan_ok(dir.path());
    tree.assert_invariants();
    let a = find(&tree, &["a.txt"]);
    let b = find(&tree, &["sub", "b.mp4"]);
    assert_eq!(tree.node(0).files, 2);
    assert_eq!(
        tree.node(a).size,
        expected_disk_size(&tree, &dir.path().join("a.txt"))
    );
    assert_eq!(tree.node(0).size, tree.node(a).size + tree.node(b).size);
    assert_eq!(tree.node(b).category, Category::Video as u8);
    let canonical = dunce::canonicalize(dir.path()).unwrap();
    assert_eq!(tree.path(b), canonical.join("sub").join("b.mp4"));
}

#[test]
fn empty_directory_gives_a_single_node() {
    let dir = tempfile::tempdir().unwrap();
    let tree = scan_ok(dir.path());
    assert_eq!(
        (tree.len(), tree.node(0).size, tree.node(0).files),
        (1, 0, 0)
    );
}

#[test]
fn root_given_with_dot_segments_is_canonicalized() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    let odd = dir.path().join("sub").join("..").join(".");
    let tree = scan_ok(&odd);
    assert_eq!(
        Path::new(tree.name(0)),
        dunce::canonicalize(dir.path()).unwrap()
    );
}

#[test]
fn file_as_root_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("f");
    fs::write(&file, b"x").unwrap();
    let err = scan(&file, &AtomicBool::new(false), &Progress::default())
        .err()
        .expect("error");
    assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
}

#[test]
fn cancelled_scan_reports_cancelled() {
    let dir = tempfile::tempdir().unwrap();
    let outcome = scan(dir.path(), &AtomicBool::new(true), &Progress::default()).unwrap();
    assert!(matches!(outcome, ScanOutcome::Cancelled));
}

#[test]
fn directory_symlinks_are_not_followed() {
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("big"), vec![0u8; 100_000]).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let link = dir.path().join("link");
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(outside.path(), &link);
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_dir(outside.path(), &link);
    if made.is_err() {
        eprintln!("skipped: this OS user cannot create symlinks");
        return;
    }
    let tree = scan_ok(dir.path());
    assert_eq!(tree.children(0).count(), 0);
    assert_eq!(tree.node(0).size, 0);
}

#[cfg(windows)]
#[test]
fn junctions_are_not_followed() {
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("big"), vec![0u8; 100_000]).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let link = dir.path().join("junction");
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(outside.path())
        .status()
        .unwrap();
    assert!(status.success(), "mklink /J needs no admin rights");
    let tree = scan_ok(dir.path());
    assert_eq!(tree.children(0).count(), 0);
}

#[cfg(unix)]
#[test]
fn unreadable_directory_is_flagged_and_scan_continues() {
    use std::os::unix::fs::PermissionsExt;
    // SAFETY: plain libc call without arguments.
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("skipped: root can read any directory");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let locked = dir.path().join("locked");
    fs::create_dir(&locked).unwrap();
    fs::write(locked.join("hidden"), b"x").unwrap();
    fs::write(dir.path().join("visible"), b"x").unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();

    let tree = scan_ok(dir.path());
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    let id = find(&tree, &["locked"]);
    assert!(tree.node(id).has(flags::ACCESS_ERROR));
    assert_eq!(tree.access_errors, 1);
    assert_eq!(tree.node(0).files, 1);
}

#[cfg(unix)]
#[test]
fn hard_linked_file_is_counted_once() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("x")).unwrap();
    fs::create_dir(dir.path().join("y")).unwrap();
    fs::write(dir.path().join("x").join("f"), vec![0u8; 50_000]).unwrap();
    fs::hard_link(
        dir.path().join("x").join("f"),
        dir.path().join("y").join("f"),
    )
    .unwrap();

    let tree = scan_ok(dir.path());
    let x = find(&tree, &["x", "f"]);
    let y = find(&tree, &["y", "f"]);
    assert_eq!(tree.node(0).size, tree.node(x).size);
    assert_eq!(tree.node(y).size, 0);
    assert!(tree.node(x).has(flags::HARDLINK));
}

#[test]
fn dir_entry_mtime_matches_symlink_metadata() {
    // Deletion safety in M2 compares the scanned mtime with a fresh `symlink_metadata`.
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("f"), b"x").unwrap();
    fs::create_dir(dir.path().join("d")).unwrap();
    for entry in fs::read_dir(dir.path()).unwrap() {
        let entry = entry.unwrap();
        let fresh = fs::symlink_metadata(entry.path()).unwrap();
        assert_eq!(
            mtime_of(&entry.metadata().unwrap()),
            mtime_of(&fresh),
            "{:?}",
            entry.path()
        );
    }
}

#[test]
fn progress_counts_files_and_dirs() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("d")).unwrap();
    fs::write(dir.path().join("d").join("f"), b"x").unwrap();
    let progress = Progress::default();
    scan(dir.path(), &AtomicBool::new(false), &progress).unwrap();
    assert_eq!(progress.files.load(Ordering::Relaxed), 1);
    assert_eq!(progress.dirs.load(Ordering::Relaxed), 2);
}

#[cfg(windows)]
#[test]
fn compressed_file_counts_its_compressed_size() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("zeros.bin");
    fs::write(&file, vec![0u8; 1 << 20]).unwrap();
    let compressed = std::process::Command::new("compact")
        .args(["/c", "/q"])
        .arg(&file)
        .output()
        .is_ok_and(|o| o.status.success());
    if !compressed {
        eprintln!("skipped: NTFS compression is not available here");
        return;
    }
    let tree = scan_ok(dir.path());
    let id = find(&tree, &["zeros.bin"]);
    assert!(
        tree.node(id).size < 512 * 1024,
        "got {}",
        tree.node(id).size
    );
}

#[test]
fn logical_length_is_kept_next_to_the_size_on_disk() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.txt"), vec![0u8; 10]).unwrap();
    fs::create_dir_all(dir.path().join("sub").join("inner")).unwrap();
    fs::write(dir.path().join("sub").join("b.bin"), vec![0u8; 5000]).unwrap();

    let tree = scan_ok(dir.path());
    tree.assert_invariants();
    let a = find(&tree, &["a.txt"]);
    let sub = find(&tree, &["sub"]);
    assert_eq!(tree.node(a).len, 10);
    assert_eq!(tree.node(0).len, 5010);
    assert_eq!((tree.node(0).dirs, tree.node(sub).dirs), (2, 1));
}

#[test]
fn a_folder_is_scanned_on_its_own_and_reported_when_gone() {
    let dir = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let sub = root.join("sub");
    fs::create_dir_all(sub.join("deep")).unwrap();
    fs::write(sub.join("a.txt"), vec![0u8; 10]).unwrap();
    fs::write(sub.join("deep").join("b.txt"), vec![0u8; 20]).unwrap();
    let (never, progress) = (AtomicBool::new(false), Progress::default());

    let Ok(FolderScan::Done(records)) = scan_folder(&sub, &root, &never, &progress) else {
        panic!("the folder is there");
    };
    let top = records.iter().find(|r| r.id == 0).expect("record 0");
    assert_eq!(
        (top.parent, top.files.len(), records.len()),
        (NO_PARENT, 1, 2)
    );
    let gone = |path: &Path| {
        matches!(
            scan_folder(path, &root, &never, &progress),
            Ok(FolderScan::Gone)
        )
    };
    assert!(gone(&root.join("nope")));
    assert!(gone(&sub.join("a.txt")), "a file is not a folder any more");
    assert!(gone(&sub.join("a.txt").join("x")), "a path through a file");
    assert!(matches!(
        scan_folder(&sub, &root, &AtomicBool::new(true), &progress),
        Ok(FolderScan::Cancelled)
    ));
}
