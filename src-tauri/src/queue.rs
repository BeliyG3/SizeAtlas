//! The scan queue: one job runs, the others wait in the order they were asked for. A job scans
//! a root, or refreshes one of its folders.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use sizeatlas_core::scanner::Progress;

use crate::dto::{QueueEntryDto, QueueState};

/// A folder to refresh: node `id` of the tree with `generation`, of the scan `scan`, at `path`.
/// A compaction meanwhile gives the tree another generation; the scan stays, and the folder is
/// found again by its path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FolderTarget {
    pub scan: u64,
    pub generation: u64,
    pub id: u32,
    pub path: PathBuf,
}

/// A scan of one root or a refresh of one of its folders, with the handles to watch and stop it.
#[derive(Clone)]
pub struct ScanJob {
    /// Canonical root.
    pub root: String,
    /// The folder to refresh; `None` scans the whole root.
    pub folder: Option<FolderTarget>,
    /// Stops the walk.
    pub cancel: Arc<AtomicBool>,
    /// The result is not applied: the job was cancelled or its root closed or forgotten. Closing
    /// the app sets only `cancel`, so a walk that has finished is still applied and saved while
    /// "Saving…" shows.
    pub discard: Arc<AtomicBool>,
    pub progress: Arc<Progress>,
}

impl ScanJob {
    pub fn new(root: String, folder: Option<FolderTarget>) -> ScanJob {
        ScanJob {
            root,
            folder,
            cancel: Arc::default(),
            discard: Arc::default(),
            progress: Arc::default(),
        }
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

#[derive(Default)]
pub struct ScanQueue {
    /// Stays set until the worker moves on, also after a cancel.
    current: Option<ScanJob>,
    pending: VecDeque<ScanJob>,
}

impl ScanQueue {
    /// Adds a scan of `root` unless one runs (and is not cancelled) or waits already; it takes the
    /// place of the waiting refreshes of the folders of `root`. Returns the job to run when
    /// nothing was running: the caller then starts the worker with it.
    pub fn push(&mut self, root: String) -> Option<ScanJob> {
        // ponytail: a root whose finished scan is still being saved counts as scanning, so a new
        // scan of it is dropped as a duplicate; queue it once the write ends if that matters.
        if self.covered(&root, None) {
            return None;
        }
        self.pending.retain(|j| j.root != root);
        self.add(ScanJob::new(root, None))
    }

    /// Adds a refresh of `folder` of `root`, unless a scan of `root` or a refresh of the same
    /// folder runs (and is not cancelled) or waits: that one covers it.
    pub fn push_folder(&mut self, root: String, folder: FolderTarget) -> Option<ScanJob> {
        if self.covered(&root, Some(&folder)) {
            return None;
        }
        self.add(ScanJob::new(root, Some(folder)))
    }

    /// Whether a job that runs or waits makes a new one for `folder` of `root` (`None`: the whole
    /// root) unneeded: a full scan covers every folder of its root, a refresh only its own path.
    fn covered(&self, root: &str, folder: Option<&FolderTarget>) -> bool {
        let path = folder.map(|f| &f.path);
        let covers = |j: &ScanJob| {
            j.root == root && (j.folder.is_none() || j.folder.as_ref().map(|f| &f.path) == path)
        };
        self.current
            .as_ref()
            .is_some_and(|j| !j.cancelled() && covers(j))
            || self.pending.iter().any(covers)
    }

    /// Runs `job` when nothing runs, else queues it.
    fn add(&mut self, job: ScanJob) -> Option<ScanJob> {
        if self.current.is_some() {
            self.pending.push_back(job);
            return None;
        }
        self.current = Some(job.clone());
        Some(job)
    }

    /// Ends the running job and starts the next waiting one, if any.
    pub fn advance(&mut self) -> Option<ScanJob> {
        self.current = self.pending.pop_front();
        self.current.clone()
    }

    /// Stops the jobs of `root`, or the running one when `None`: cancels and discards it if it
    /// runs, drops them if they wait. Returns whether a waiting job was dropped.
    pub fn cancel(&mut self, root: Option<&str>) -> bool {
        if let Some(job) = &self.current
            && root.is_none_or(|r| job.root == r)
        {
            job.discard.store(true, Ordering::Relaxed);
            job.cancel.store(true, Ordering::Relaxed);
        }
        let Some(root) = root else { return false };
        let before = self.pending.len();
        self.pending.retain(|j| j.root != root);
        self.pending.len() != before
    }

    /// Closing the app: stops the running walk and forgets the waiting jobs.
    pub fn stop_all(&mut self) {
        if let Some(job) = &self.current {
            job.cancel.store(true, Ordering::Relaxed);
        }
        self.pending.clear();
    }

    /// The running job first, then the waiting ones in order.
    pub fn entries(&self) -> Vec<QueueEntryDto> {
        let entry = |job: &ScanJob, state| QueueEntryDto {
            root: job.root.clone(),
            state,
            folder: job.folder.as_ref().map(|f| f.path.display().to_string()),
        };
        let current = self.current.iter().map(|j| entry(j, QueueState::Scanning));
        let pending = self.pending.iter().map(|j| entry(j, QueueState::Queued));
        current.chain(pending).collect()
    }

    /// Whether a job of `root` runs (a cancelled one, until its walk stops) or waits.
    pub fn has(&self, root: &str) -> bool {
        self.current
            .iter()
            .chain(&self.pending)
            .any(|j| j.root == root)
    }

    /// Component-based containment: a full scan also blocks scans of its descendants.
    pub fn full_scan_contains(&self, path: &str, include_equal: bool) -> bool {
        let path = std::path::Path::new(path);
        self.current.iter().chain(&self.pending).any(|job| {
            job.folder.is_none()
                && path.starts_with(&job.root)
                && (include_equal || path != std::path::Path::new(&job.root))
        })
    }
}

#[cfg(test)]
mod tests;
