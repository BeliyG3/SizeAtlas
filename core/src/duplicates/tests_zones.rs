//! Zones of the duplicate search: which candidates are protected or synced on each OS.

use super::candidates::candidates;
use super::*;
use crate::cleanup::paths::{Known, node_path};
use crate::cleanup::tests::{Item, build, it, win};

/// A candidate-sized file.
pub(super) fn file(path: &str) -> Item {
    it(path).size(5000)
}

pub(super) fn root(tree: &Tree) -> SearchRoot<'_> {
    SearchRoot {
        tree,
        generation: 1,
        volume: "v",
        disk: DiskKind::Ssd,
    }
}

pub(super) fn opts<'a>(os: Os, known: &'a Known) -> Options<'a> {
    Options {
        query: None,
        include_zones: true,
        os,
        known,
        now_ns: 0,
    }
}

/// The full path of every candidate of a tree under `root` holding `items`, with whether it is
/// protected and synced; sorted.
fn marks(root_path: &str, items: Vec<Item>, os: Os, known: &Known) -> Vec<(String, bool, bool)> {
    let tree = build(root_path, items);
    let mut out: Vec<_> = candidates(&[root(&tree)], &opts(os, known))
        .iter()
        .map(|c| (node_path(&tree, c.node, os), c.protected, c.synced))
        .collect();
    out.sort();
    out
}

/// Whether the one file at the full path `path` (drive or `/` first) is protected.
fn protected(path: &str, os: Os, known: &Known) -> bool {
    let (root, rest) = match os {
        Os::Windows => path.split_at(3),
        _ => path.split_at(1),
    };
    let found = marks(root, vec![file(rest)], os, known);
    assert_eq!(found.len(), 1, "{path}");
    assert!(found[0].0.eq_ignore_ascii_case(path), "{path}");
    found[0].1
}

fn mac() -> Known {
    Known {
        home: "/Users/u".into(),
        ..Known::default()
    }
}

fn linux() -> Known {
    Known {
        home: "/home/u".into(),
        ..Known::default()
    }
}

#[test]
fn windows_zones_hold_on_any_volume() {
    let known = win().known;
    for path in [
        r"D:\Windows\Web\a.jpg",
        r"C:\Windows.old\x.jpg",
        r"E:\Program Files\App\a.png",
        r"c:\program files\x.png",
        r"C:\ProgramData\x.jpg",
        r"D:\Recovery\x.jpg",
        r"C:\$WinREAgent\x.jpg",
        r"D:\Users\other\AppData\Local\x.jpg",
        r"C:\Users\u\AppData\Roaming\x.jpg",
        r"D:\Games\steamapps\common\x.png",
        r"C:\Users\u\.config\x.png",
    ] {
        assert!(protected(path, Os::Windows, &known), "{path}");
    }
    for path in [
        r"C:\Users\u\Pictures\a.jpg",
        r"D:\Backup\Windows\a.jpg",
        r"D:\Photos\.thumbs\a.jpg",
    ] {
        assert!(!protected(path, Os::Windows, &known), "{path}");
    }
}

#[test]
fn projects_are_zones_everywhere() {
    let known = win().known;
    for path in [
        r"D:\work\node_modules\p\x.png",
        r"D:\work\.git\objects\x",
        r"D:\work\.venv\x",
    ] {
        assert!(protected(path, Os::Windows, &known), "{path}");
    }
    assert!(!protected(r"D:\work\src\x.png", Os::Windows, &known));
    let venv = vec![file(r"work\env\lib\x.png"), it(r"work\env\pyvenv.cfg")];
    assert_eq!(
        marks(r"D:\", venv, Os::Windows, &known),
        [(r"D:\work\env\lib\x.png".to_owned(), true, false)]
    );
}

#[test]
fn mac_packages_and_libraries_are_zones() {
    for path in [
        "/Users/u/Pictures/Photos Library.photoslibrary/originals/a.jpg",
        "/Applications/X.app/Contents/a.png",
        "/Users/u/Library/Caches/a.png",
        "/Volumes/E/Cat.lrlibrary/a.jpg",
        "/Users/u/Music/Old.aplibrary/a.jpg",
        "/opt/x.png",
        "/private/var/x.png",
    ] {
        assert!(protected(path, Os::Mac, &mac()), "{path}");
    }
    assert!(!protected("/Users/u/Pictures/a.jpg", Os::Mac, &mac()));
}

#[test]
fn linux_system_places_are_zones() {
    for path in [
        "/usr/share/a.png",
        "/lib64/a.png",
        "/etc/a.png",
        "/boot/a.png",
        "/sbin/a.bin",
        "/home/u/.cache/a.png",
    ] {
        assert!(protected(path, Os::Linux, &linux()), "{path}");
    }
    for path in ["/home/u/Pictures/a.png", "/data/lib/a.png"] {
        assert!(!protected(path, Os::Linux, &linux()), "{path}");
    }
}

#[test]
fn synced_folders_are_marked_not_excluded() {
    let found = marks(
        r"C:\",
        vec![file(r"Users\u\OneDrive\a.jpg")],
        Os::Windows,
        &win().known,
    );
    assert_eq!(
        found,
        [(r"C:\Users\u\OneDrive\a.jpg".to_owned(), false, true)]
    );
}

#[test]
fn zones_are_left_out_unless_included() {
    let known = win().known;
    let tree = build(
        r"E:\",
        vec![file(r"Program Files\App\a.png"), file(r"Photos\a.png")],
    );
    let opts = Options {
        include_zones: false,
        ..opts(Os::Windows, &known)
    };
    let found = candidates(&[root(&tree)], &opts);
    let paths: Vec<_> = found
        .iter()
        .map(|c| node_path(&tree, c.node, Os::Windows))
        .collect();
    assert_eq!(paths, [r"E:\Photos\a.png"]);
}

#[test]
fn a_root_opened_inside_a_zone_is_protected() {
    let known = win().known;
    for root_path in [
        r"E:\Program Files\App",
        r"D:\work\.git",
        r"C:\Users\u\AppData\Local\X",
    ] {
        let found = marks(
            root_path,
            vec![file("a.png"), file(r"sub\b.png")],
            Os::Windows,
            &known,
        );
        assert_eq!(found.len(), 2, "{root_path}");
        assert!(found.iter().all(|m| m.1), "{root_path}");
    }
}
