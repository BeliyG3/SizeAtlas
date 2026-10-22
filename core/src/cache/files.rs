//! The cache files of one scan root: the current scan, the last full scan and the full scan before it.
//! Only a full scan (first scan or Rescan) rotates `full` into `base`; a plain `save` touches `current` alone.
//! The extensions `.full` and `.base` keep these files out of the `.bin` listing of cached scans.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::{CacheError, cache_path, encode, rename_with_retry, tmp_path};
use crate::tree::Tree;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanFiles {
    /// Today's scan cache (`.bin`), rewritten by every save.
    pub current: PathBuf,
    /// The last full scan, never touched by anything but the next full scan.
    pub full: PathBuf,
    /// The full scan before `full`: the baseline for "growth since the last scan".
    pub base: PathBuf,
}

pub fn scan_files(cache_dir: &Path, canonical_root: &Path) -> ScanFiles {
    let current = cache_path(cache_dir, canonical_root);
    ScanFiles {
        full: current.with_extension("full"),
        base: current.with_extension("base"),
        current,
    }
}

/// Saves a finished full scan as `current` and `full`, and keeps the previous full scan as `base`.
/// Both new files are fully written before any old one is renamed, so a failed write loses nothing.
/// With neither `full` nor `base` yet, an old `current` (written before this feature) becomes the `base`;
/// a `base` without a `full` is a half-finished rotation and stays as it is.
pub fn save_full_scan(tree: &Tree, files: &ScanFiles) -> Result<(), CacheError> {
    let current_tmp = tmp_path(&files.current);
    let full_tmp = tmp_path(&files.full);
    let result = write_both(tree, &current_tmp, &full_tmp).and_then(|()| rotate(files));
    if result.is_err() {
        let _ = fs::remove_file(&current_tmp);
        let _ = fs::remove_file(&full_tmp);
    }
    result
}

fn write_both(tree: &Tree, current_tmp: &Path, full_tmp: &Path) -> Result<(), CacheError> {
    fs::write(current_tmp, encode(tree)?)?;
    fs::copy(current_tmp, full_tmp)?;
    Ok(())
}

fn rotate(files: &ScanFiles) -> Result<(), CacheError> {
    if files.full.exists() {
        rename_with_retry(&files.full, &files.base)?;
    } else if !files.base.exists() && files.current.exists() {
        rename_with_retry(&files.current, &files.base)?;
    }
    rename_with_retry(&tmp_path(&files.current), &files.current)?;
    rename_with_retry(&tmp_path(&files.full), &files.full)?;
    Ok(())
}

/// Deletes all three files; one that is already missing is not an error.
pub fn remove_all(files: &ScanFiles) -> io::Result<()> {
    for path in [&files.current, &files.full, &files.base] {
        match fs::remove_file(path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
    }
    Ok(())
}
