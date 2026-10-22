//! The baseline of an open root: its tree compared with the full scan before the last one.
//! Computed without any lock (reading the saved scan may take seconds), then given to the root.

use std::path::Path;
use std::sync::Arc;

use sizeatlas_core::baseline::{Baseline, compare, compatible};
use sizeatlas_core::cache::{self, ScanFiles, scan_files};
use sizeatlas_core::tree::{Tree, flags};

use crate::state::AppState;

/// `current` compared with the saved full scan `files.base`; `None` when that file is missing,
/// unreadable, outdated or not comparable. The saved tree is dropped before returning.
pub fn load_baseline(files: &ScanFiles, current: &Tree) -> Option<Baseline> {
    let (_, base) = cache::load(&files.base).ok()?;
    compatible(current, &base).then(|| compare(current, &base))
}

/// Computes the baseline of the open root `root` and gives it to the root, again if its tree
/// changed meanwhile. A first scan still running gets none: its end computes it.
pub fn refresh(state: &AppState, cache_dir: &Path, root: &str) {
    let files = scan_files(cache_dir, Path::new(root));
    loop {
        let Some((generation, tree)) = state.root_tree(root) else {
            return; // closed
        };
        if tree.node(0).has(flags::SCANNING) {
            return;
        }
        let rev = tree.rev;
        let baseline = load_baseline(&files, &tree).map(Arc::new);
        // Giving it waits until no read holds the tree.
        drop(tree);
        if state.set_baseline(generation, rev, baseline) {
            return;
        }
    }
}

#[cfg(test)]
mod tests;
