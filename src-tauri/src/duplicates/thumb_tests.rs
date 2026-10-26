//! Thumbnails: only live files of an open tree, only what the webview shows, nothing that
//! would be huge to decode, and never a cloud file.

use std::fs::{self, File};

use tempfile::TempDir;

use super::tests::{dir_named, scanned, state};
use super::thumb::thumbnail;
use crate::error::CmdError;
use crate::recycle::fixture::{id, settle};
use crate::state::AppState;

fn png(w: u32, h: u32) -> Vec<u8> {
    let mut d = b"\x89PNG\r\n\x1a\n".to_vec();
    d.extend([0, 0, 0, 13]);
    d.extend(b"IHDR");
    d.extend(w.to_be_bytes());
    d.extend(h.to_be_bytes());
    d.extend([8, 6, 0, 0, 0]);
    d
}

struct Shown {
    state: AppState,
    dir: TempDir,
    root: String,
    generation: u64,
}

impl Shown {
    /// The files `(name, bytes)` in a scanned, open folder; a folder `sub` too.
    fn new(files: &[(&str, &[u8])]) -> Shown {
        let (state, _) = state();
        let dir = dir_named("thumb-");
        fs::create_dir(dir.path().join("sub")).unwrap();
        for (name, bytes) in files {
            let path = dir.path().join(name);
            fs::write(&path, bytes).unwrap();
            settle(&path);
        }
        let tree = scanned(dir.path());
        let root = tree.name(0).to_owned();
        let generation = state.install_tree(tree);
        Shown {
            state,
            dir,
            root,
            generation,
        }
    }

    fn of(&self, name: &str) -> Result<Vec<u8>, CmdError> {
        let node = id(&self.state, self.generation, &[name]);
        thumbnail(&self.state, &self.root, self.generation, node)
    }
}

#[test]
fn a_small_png_comes_back_whole() {
    let bytes = png(100, 50);
    let t = Shown::new(&[("a.PNG", &bytes)]);
    assert_eq!(t.of("a.PNG").unwrap(), bytes);
}

#[test]
fn other_types_get_nothing() {
    let t = Shown::new(&[("a.txt", &png(10, 10))]);
    assert!(t.of("a.txt").unwrap().is_empty());
}

#[test]
fn a_file_over_32_mb_gets_nothing() {
    let t = Shown::new(&[]);
    let path = t.dir.path().join("big.png");
    File::create(&path).unwrap().set_len(33 << 20).unwrap();
    settle(&path);
    let tree = scanned(t.dir.path());
    let root = tree.name(0).to_owned();
    let generation = t.state.install_tree(tree);
    let node = id(&t.state, generation, &["big.png"]);
    assert!(
        thumbnail(&t.state, &root, generation, node)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_header_over_40_megapixels_gets_nothing() {
    let t = Shown::new(&[("bomb.png", &png(8000, 6000)), ("ok.png", &png(8000, 5000))]);
    assert!(t.of("bomb.png").unwrap().is_empty());
    // Exactly 40 megapixels is allowed.
    assert!(!t.of("ok.png").unwrap().is_empty());
}

#[test]
fn a_renamed_png_bomb_gets_nothing() {
    let t = Shown::new(&[
        ("bomb.ico", &png(8000, 6000)),
        ("bomb.svg", &png(8000, 6000)),
    ]);
    assert!(t.of("bomb.ico").unwrap().is_empty());
    assert!(t.of("bomb.svg").unwrap().is_empty());
}

#[test]
fn a_known_name_needs_a_known_content_but_svg_and_avif_do_not() {
    let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
    let t = Shown::new(&[
        ("a.png", b"not a png"),
        ("cut.jpg", &[0xFF, 0xD8, 0xFF, 0xE0]),
        ("a.svg", svg),
        ("a.avif", b"\0\0\0\x1cftypavif"),
    ]);
    assert!(t.of("a.png").unwrap().is_empty());
    assert!(t.of("cut.jpg").unwrap().is_empty());
    assert_eq!(t.of("a.svg").unwrap(), svg);
    assert!(!t.of("a.avif").unwrap().is_empty());
}

#[cfg(windows)]
#[test]
fn an_offline_image_gets_nothing() {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_OFFLINE, SetFileAttributesW};

    let t = Shown::new(&[("a.png", &png(10, 10))]);
    let wide: Vec<u16> = (t.dir.path().join("a.png").as_os_str().encode_wide())
        .chain([0])
        .collect();
    // SAFETY: `wide` is a NUL-terminated path that lives through the call.
    assert_ne!(
        unsafe { SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_OFFLINE) },
        0
    );
    assert!(t.of("a.png").unwrap().is_empty());
}

#[test]
fn a_changed_or_removed_file_gets_nothing() {
    let t = Shown::new(&[("a.png", &png(10, 10)), ("b.png", &png(10, 10))]);
    fs::write(t.dir.path().join("a.png"), png(20, 20)).unwrap();
    fs::remove_file(t.dir.path().join("b.png")).unwrap();
    assert!(t.of("a.png").unwrap().is_empty());
    assert!(t.of("b.png").unwrap().is_empty());
}

#[test]
fn a_folder_gets_nothing() {
    let t = Shown::new(&[]);
    assert!(t.of("sub").unwrap().is_empty());
    assert!(
        thumbnail(&t.state, &t.root, t.generation, 0)
            .unwrap()
            .is_empty()
    );
    assert!(
        thumbnail(&t.state, &t.root, t.generation, 9999)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn an_old_generation_is_stale() {
    let t = Shown::new(&[("a.png", &png(10, 10))]);
    let node = id(&t.state, t.generation, &["a.png"]);
    assert_eq!(
        thumbnail(&t.state, &t.root, t.generation + 1, node),
        Err(CmdError::StaleId)
    );
    assert_eq!(
        thumbnail(&t.state, "elsewhere", t.generation, node),
        Err(CmdError::StaleId)
    );
}
