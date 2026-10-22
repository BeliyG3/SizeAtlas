//! The baseline of an open root: its tree compared with the full scan before the last one.
//! Computed without any lock (reading the saved scan may take seconds), then given to the root.

use std::path::Path;
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
/// the root's baseline changed.
pub fn refresh(state: &AppState, cache_dir: &Path, root: &str) -> bool {
    let files = scan_files(cache_dir, Path::new(root));
    loop {
        let Some((generation, tree)) = state.root_tree(root) else {
            return false; // closed
        };
        if tree.node(0).has(flags::SCANNING) {
            return false;
        }
        let rev = tree.rev;
        let baseline = load_baseline(&files, &tree).map(Arc::new);
        if let Some(changed) = state.set_baseline(generation, rev, baseline) {
            return changed;
        }
    }
}

#[cfg(test)]
mod tests;
