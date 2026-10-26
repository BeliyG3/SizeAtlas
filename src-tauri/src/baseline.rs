//! The baseline of an open root: its tree compared with the full scan before the last one.
//! Computed without the data lock (reading the saved scan may take seconds) but while holding
//! the root's write, as every other long work on an open tree, then given to the root.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use sizeatlas_core::baseline::{Baseline, compare, compatible};
use sizeatlas_core::cache::{self, ScanFiles, scan_files};
use sizeatlas_core::tree::{Tree, flags};

use crate::state::AppState;

/// `current` compared with the saved full scan `files.base`; `None` when that file is missing,
/// unreadable, outdated or not comparable, or when `files.full` is not the scan of `current` (its
/// full save failed, so `base` is not the scan before it). The saved tree is dropped before
/// returning.
// ponytail: scans are told apart by `scanned_at`, in whole seconds; two full scans of one root
// in the same second, the second one unsaved, would pass. Add a scan id to the header if needed.
pub fn load_baseline(files: &ScanFiles, current: &Tree) -> Option<Baseline> {
    let full = cache::read_header(&files.full).ok()?;
    if full.scanned_at != current.scanned_at {
        return None;
    }
    let (_, base) = cache::load(&files.base).ok()?;
    compatible(current, &base).then(|| compare(current, &base))
}

/// Computes the baseline of the open root `root` and gives it to the root, again if its tree
/// changed meanwhile. A first scan still running gets none: its end computes it. Returns whether
/// the root's baseline changed. The caller holds the root's write (see `state::change::tree_mut`).
pub fn refresh(state: &AppState, cache_dir: &Path, root: &str) -> bool {
    let files = scan_files(cache_dir, Path::new(root));
    give(state, root, |tree| load_baseline(&files, tree))
}

/// `refresh` in the background, for a saved scan just opened: waits for the root's write, which
/// a trash, a saved scan being written and the end of a scan hold, so it runs between them.
/// Returns whether the baseline changed; `false` once the app is closing.
pub async fn refresh_later(state: AppState, cache_dir: PathBuf, root: String) -> bool {
    let Ok(write) = state.begin_write(&root).await else {
        return false;
    };
    tauri::async_runtime::spawn_blocking(move || {
        let changed = refresh(&state, &cache_dir, &root);
        drop(write);
        changed
    })
    .await
    .unwrap_or(false)
}

/// Whether the root `root` has a previous full scan to compare with: `files.base`, or, for a full
/// scan about to be saved (`saving`), a saved scan that its save turns into `base` (see
/// `cache::save_full_scan`). Without one its baseline is not pending: nothing would come.
pub fn comparable(cache_dir: &Path, root: &str, saving: bool) -> bool {
    let files = scan_files(cache_dir, Path::new(root));
    files.base.exists() || (saving && (files.full.exists() || files.current.exists()))
}

/// Like `refresh`, for a full scan whose save failed: `.base` is not the scan before it, so
/// the root gets no baseline.
pub fn forgo(state: &AppState, root: &str) -> bool {
    give(state, root, |_| None)
}

/// Gives the open root `root` the baseline `compute` makes of its tree; see `refresh`.
fn give(state: &AppState, root: &str, compute: impl Fn(&Tree) -> Option<Baseline>) -> bool {
    loop {
        let Some((generation, tree)) = state.root_tree(root) else {
            return false; // closed
        };
        if tree.node(0).has(flags::SCANNING) {
            return false;
        }
        let rev = tree.rev;
        let baseline = compute(&tree).map(Arc::new);
        // Let go before waiting for the write lock: a change holding it waits for this tree.
        drop(tree);
        if let Some(changed) = state.set_baseline(generation, rev, baseline) {
            return changed;
        }
    }
}

#[cfg(test)]
mod tests;
