//! Blocking work on open roots and saved scans: walk a queued root, save it, open a saved scan,
//! close a root, forget a saved scan. Plus the queue methods of `AppState`.

use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::Ordering;

use sizeatlas_core::cache::{self, CacheError, cache_path};
use sizeatlas_core::scanner::{self, FolderScan, ScanOutcome};
use sizeatlas_core::tree::Tree;

use crate::dto::Summary;
use crate::error::CmdError;
use crate::exit::RUNNING;
use crate::queue::{FolderTarget, ScanJob};
use crate::sources;
use crate::state::AppState;

impl AppState {
    /// Queues a full scan of a canonical root; refused while the app is closing. Returns the job
    /// to run when nothing was running: the caller then starts the worker with it.
    pub fn enqueue(&self, root: String) -> Result<Option<ScanJob>, CmdError> {
        self.enqueue_folder(root, None)
    }

    /// Like `enqueue`, for a refresh of `folder` of `root` (`None`: the whole root).
    pub fn enqueue_folder(
        &self,
        root: String,
        folder: Option<FolderTarget>,
    ) -> Result<Option<ScanJob>, CmdError> {
        let mut scans = self.scans();
        // Under the queue lock, which `on_exit_request` holds while it decides.
        if self.0.exit.load(Ordering::Acquire) != RUNNING {
            return Err(CmdError::Busy);
        }
        if scans.full_scan_contains(&root, folder.is_some()) {
            return Err(CmdError::Busy);
        }
        Ok(match folder {
            Some(folder) => scans.push_folder(root, folder),
            None => scans.push(root),
        })
    }

    /// See `ScanQueue::cancel`.
    pub fn cancel_scan(&self, root: Option<&str>) -> bool {
        self.scans().cancel(root)
    }

    /// Ends the running scan and starts the next one; `None` when the queue is empty.
    pub fn next_scan(&self) -> Option<ScanJob> {
        self.scans().advance()
    }

    /// A running job prevents trash; a waiting rescan still has an editable complete tree.
    pub fn is_scanning(&self, root: &str) -> bool {
        self.scans().running(root)
    }
}

/// Walks the root of `job` without any lock; `None` when the scan was cancelled.
pub fn walk(job: &ScanJob) -> Result<Option<Tree>, CmdError> {
    let root = Path::new(&job.root);
    match scanner::scan(root, &job.cancel, &job.progress) {
        Ok(ScanOutcome::Done(mut tree)) => {
            // Measured right after the walk, so "unaccounted" compares numbers of the same time.
            tree.volume = sources::volume_usage(Path::new(tree.name(0)));
            Ok(Some(tree))
        }
        Ok(ScanOutcome::Cancelled) => Ok(None),
        Err(e) => Err(CmdError::io(root, e)),
    }
}

/// Walks the folder of a refresh without any lock; `None` when it was cancelled.
pub fn walk_folder(job: &ScanJob, folder: &FolderTarget) -> Result<Option<FolderScan>, CmdError> {
    match scanner::scan_folder(
        &folder.path,
        Path::new(&job.root),
        &job.cancel,
        &job.progress,
    ) {
        Ok(FolderScan::Cancelled) => Ok(None),
        Ok(found) => Ok(Some(found)),
        Err(e) => Err(CmdError::io(&folder.path, e)),
    }
}

/// Writes the saved scan of a tree without any lock; on failure removes the old file so a
/// stale scan is never reopened.
pub fn save(tree: &Tree, cache_dir: &Path) -> Result<(), CmdError> {
    let file = cache_path(cache_dir, Path::new(tree.name(0)));
    let saved = fs::create_dir_all(cache_dir)
        .map_err(CacheError::Io)
        .and_then(|()| cache::save(tree, &file));
    if saved.is_err() {
        let _ = fs::remove_file(&file);
        return Err(CmdError::CacheNotSaved);
    }
    Ok(())
}

/// Adds the saved scan of `root` as a root, or replaces the open one in place.
// ponytail: not synchronized with `forget` of the same root, so a load that ends just after the
// forget opens the root again (its file is gone); hold `begin_write` here if that matters.
pub fn open_cached(state: &AppState, cache_dir: &Path, root: &str) -> Result<Summary, CmdError> {
    state.refuse_cached(root)?;
    let file = cache_path(cache_dir, Path::new(root));
    let (_, tree) = cache::load(&file).map_err(|e| match e {
        CacheError::Invalid(_) => CmdError::CacheInvalid,
        CacheError::Outdated { .. } => CmdError::CacheOutdated,
        CacheError::Io(err) => CmdError::io(&file, err),
    })?;
    // Described before installing: a rescan may replace the tree right after.
    let mut summary = Summary::of(0, &tree);
    summary.generation = state.install_cached(tree)?;
    Ok(summary)
}

/// Closes a root by its canonical path, stopping its scan first, so a scan that ends meanwhile
/// cannot reopen it. By path, not generation: a rescan may have replaced the tree the UI shows.
pub fn close_root(state: &AppState, root: &str) {
    state.cancel_scan(Some(root));
    state.close_path(root);
}

/// Deletes the saved scan of `root` and closes the root, stopping its scan first. The caller
/// holds `begin_write`, so a scan of this root that is being saved is written before the
/// file goes, and is not installed again afterwards.
pub fn forget(state: &AppState, cache_dir: &Path, root: &str) -> Result<(), CmdError> {
    close_root(state, root);
    let file = cache_path(cache_dir, Path::new(root));
    match fs::remove_file(&file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(CmdError::io(&file, e)),
    }
}

#[cfg(test)]
mod tests;
