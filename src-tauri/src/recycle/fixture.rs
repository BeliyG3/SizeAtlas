//! A scanned folder and stand-ins for the trash, shared by the tests of `recycle`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::thread;
use std::time::{Duration, Instant};

use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};
use sizeatlas_core::tree::ListOrder;
use tempfile::TempDir;
use tokio::sync::OwnedMutexGuard;

use super::{listed_mtime, modified};
use crate::error::CmdError;
use crate::state::{AppState, TrashItem};
use crate::writes::WriteGuard;

/// root/top.bin and root/sub/{x.bin, y.bin}, scanned and open; returns the folder and the
/// generation of its tree.
pub fn open(state: &AppState) -> (TempDir, u64) {
    let dir = tempfile::tempdir().unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    fs::write(sub.join("x.bin"), vec![0u8; 1000]).unwrap();
    fs::write(sub.join("y.bin"), vec![0u8; 2000]).unwrap();
    fs::write(dir.path().join("top.bin"), vec![0u8; 3000]).unwrap();
    for item in [
        sub.join("x.bin"),
        sub.join("y.bin"),
        sub,
        dir.path().join("top.bin"),
    ] {
        settle(&item);
    }
    let ScanOutcome::Done(tree) =
        scan(dir.path(), &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    let generation = state.install_tree(tree);
    (dir, generation)
}

/// Waits until the listing of the folder of `path` shows the time `path` has. On Windows the
/// listing catches up a moment after a change; a scan takes the listed time.
pub fn settle(path: &Path) {
    let start = Instant::now();
    while listed_mtime(path) != modified(path) {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "the listing never caught up"
        );
        thread::sleep(Duration::from_millis(5));
    }
}

/// Id of the item at `path` below the root.
pub fn id(state: &AppState, generation: u64, path: &[&str]) -> u32 {
    path.iter().fold(0, |at, name| {
        state
            .children(generation, at, 0, 100, ListOrder::DEFAULT)
            .unwrap()
            .items
            .into_iter()
            .find(|i| i.name == *name)
            .expect("item exists")
            .id
    })
}

pub fn rev(state: &AppState, generation: u64) -> u64 {
    state.summary(generation).unwrap().rev
}

/// Path of `names` below the root, as the tree spells it.
pub fn real(dir: &TempDir, names: &[&str]) -> PathBuf {
    let canonical = dunce::canonicalize(dir.path()).unwrap();
    names.iter().fold(canonical, |path, name| path.join(name))
}

/// The locks a trash request of `root` holds while it runs: the turn of its volume, then the
/// root's write.
pub fn hold_like_a_trash(state: &AppState, root: &str) -> (OwnedMutexGuard<()>, WriteGuard) {
    let turn = tauri::async_runtime::block_on(state.volume_turn(&state.volume_of(root)));
    let write = tauri::async_runtime::block_on(state.begin_write(root)).unwrap();
    (turn, write)
}

/// Every item may go (the system's trash check is `bin_takes` with `sizeatlas_core::can_recycle`).
pub fn anywhere(_: &TrashItem) -> Result<(), CmdError> {
    Ok(())
}

/// A stand-in for the OS trash: deletes for good and records what it got.
pub fn deleting(log: &Mutex<Vec<PathBuf>>) -> impl Fn(&Path) -> Result<(), String> + '_ {
    move |path| {
        log.lock().unwrap().push(path.to_owned());
        let removed = if path.is_dir() {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        };
        removed.map_err(|e| e.to_string())
    }
}

/// A directory link at `link` to `target`: a junction on Windows, a symlink on Unix. `false`
/// when the system does not allow it here.
pub fn link(target: &Path, link: &Path) -> bool {
    #[cfg(windows)]
    return std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .is_ok_and(|out| out.status.success());
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, link).is_ok();
}
