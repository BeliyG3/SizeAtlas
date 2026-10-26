//! Blocking work on open roots and saved scans: walk a queued root, save it, open a saved scan,
//! close a root, forget a saved scan. Plus the queue methods of `AppState`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use sizeatlas_core::cache::{self, CacheError, ScanFiles, cache_path, scan_files};
use sizeatlas_core::scanner::{self, FolderScan, ScanOutcome};
use sizeatlas_core::tree::Tree;

use crate::baseline;
use crate::dto::Summary;
use crate::error::CmdError;
use crate::exit::RUNNING;
use crate::queue::{FolderTarget, ScanJob, TrashedPath};
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

    /// See `ScanQueue::note_trashed`.
    pub fn note_trashed(&self, items: Vec<TrashedPath>) {
        self.scans().note_trashed(items);
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
/// stale scan is never reopened. The last full scans stay as they are.
pub fn save(tree: &Tree, cache_dir: &Path) -> Result<(), CmdError> {
    write_scan(tree, cache_dir, |files| cache::save(tree, &files.current))
}

/// Like `save`, for a finished full scan: it also becomes the last full scan, and the one before
/// it the baseline (see `cache::save_full_scan`).
pub fn save_full(tree: &Tree, cache_dir: &Path) -> Result<(), CmdError> {
    write_scan(tree, cache_dir, |files| cache::save_full_scan(tree, files))
}

fn write_scan(
    tree: &Tree,
    cache_dir: &Path,
    write: impl FnOnce(&ScanFiles) -> Result<(), CacheError>,
) -> Result<(), CmdError> {
    let files = scan_files(cache_dir, Path::new(tree.name(0)));
    let saved = fs::create_dir_all(cache_dir)
        .map_err(CacheError::Io)
        .and_then(|()| write(&files));
    if saved.is_err() {
        let _ = fs::remove_file(&files.current);
        return Err(CmdError::CacheNotSaved);
    }
    Ok(())
}

/// Adds the saved scan of `root` as a root, or replaces the open one in place; when the open
/// root is that very scan, it stays as it is and its summary comes back. A baseline still
/// pending comes later (`baseline::refresh_later`): comparing reads another saved scan. The
/// caller holds the write of `root` (see `open_cached_waiting`).
pub fn open_cached(state: &AppState, cache_dir: &Path, root: &str) -> Result<Summary, CmdError> {
    state.refuse_cached(root)?;
    let file = cache_path(cache_dir, Path::new(root));
    // Every change of an open tree saves it with the time of its scan.
    let saved_at = cache::read_header(&file).map(|h| h.scanned_at).ok();
    if let Some((generation, tree)) = state.root_tree(root)
        && saved_at == Some(tree.scanned_at)
    {
        // Before the data lock is taken again (see `state::change::tree_mut`).
        drop(tree);
        return state.summary(generation);
    }
    let (_, tree) = cache::load(&file).map_err(|e| match e {
        CacheError::Invalid(_) => CmdError::CacheInvalid,
        CacheError::Outdated { .. } => CmdError::CacheOutdated,
        CacheError::Io(err) => CmdError::io(&file, err),
    })?;
    // The app started closing while the file was read: nothing to show any more.
    if state.closing() {
        return Err(CmdError::Busy);
    }
    // Described before installing: a rescan may replace the tree right after.
    // Compared afterwards, if there is anything to compare with.
    let comparable = baseline::comparable(cache_dir, root, false);
    let mut summary = Summary::of(0, &tree, None, 0, comparable);
    summary.generation = state.install_cached(tree, comparable)?;
    Ok(summary)
}

/// `open_cached` once no write of `root` runs, holding the root's write meanwhile, as every
/// change of its tree: a trash, a saved scan being written and a forget of the root end before
/// the saved scan is read, so it lists what they left and none of them replaces or deletes it
/// meanwhile.
// ponytail: it waits only for its own root, but holds the write while the file is read, so a
// trash or a scan's save of this root, or closing the app, waits for a large saved scan to
// load; read first and re-check `scanned_at` under the write if that wait shows.
pub async fn open_cached_waiting(
    state: AppState,
    cache_dir: PathBuf,
    root: String,
) -> Result<Summary, CmdError> {
    let write = state.begin_write(&root).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let opened = open_cached(&state, &cache_dir, &root);
        drop(write);
        opened
    })
    .await?
}

/// Closes a root by its canonical path, stopping its scan first, so a scan that ends meanwhile
/// cannot reopen it. By path, not generation: a rescan may have replaced the tree the UI shows.
pub fn close_root(state: &AppState, root: &str) {
    state.cancel_scan(Some(root));
    state.close_path(root);
}

/// Deletes the saved scans of `root` and closes the root, stopping its scan first. The caller
/// holds the root's write, so a scan of this root that is being saved is written before the
/// file goes, and is not installed again afterwards.
pub fn forget(state: &AppState, cache_dir: &Path, root: &str) -> Result<(), CmdError> {
    close_root(state, root);
    let files = scan_files(cache_dir, Path::new(root));
    cache::remove_all(&files).map_err(|e| CmdError::io(&files.current, e))
}

#[cfg(test)]
mod tests;
