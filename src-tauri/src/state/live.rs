//! Identity and cleanup of a first scan's provisional tree.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use sizeatlas_core::tree::{Tree, flags};

use super::{AppState, OpenRoot};
use crate::error::CmdError;
use crate::queue::ScanJob;

impl AppState {
    pub fn has_root(&self, root: &str) -> bool {
        self.read_data().find(root).is_some()
    }

    /// Serialize the worker's first-scan decision with cache installation.
    pub fn begin_first_scan(&self, job: &ScanJob) -> bool {
        let _scans = self.scans();
        let first = !self.has_root(&job.root);
        job.first_scan.store(first, Ordering::Relaxed);
        first
    }

    /// Replaces a root opened between the worker's first-scan decision and its initial listing.
    /// The job's discard flag is checked under the installation lock.
    pub fn start_live(&self, job: &ScanJob, tree: Tree) -> Option<u64> {
        let scans = self.scans();
        job.first_scan.store(true, Ordering::Relaxed);
        let mut data = self.write_data();
        if job.cancelled() || job.discard.load(Ordering::Relaxed) || self.closing() {
            return None;
        }
        data.generation += 1;
        let generation = data.generation;
        let installed = OpenRoot {
            generation,
            scan: generation,
            tree: Arc::new(tree),
            baseline: None,
            baseline_rev: 0,
            baseline_pending: false,
        };
        let old = if let Some(at) = data.find(installed.tree.name(0)) {
            Some(std::mem::replace(&mut data.roots[at], installed))
        } else {
            data.roots.push(installed);
            None
        };
        drop(data);
        drop(scans);
        if let Some(old) = old {
            std::thread::spawn(move || drop(old));
        }
        Some(generation)
    }

    /// Cache reads must not replace an active first scan. Hold the queue guard through install.
    /// For `comparable` see `install_scan`.
    pub fn install_cached(&self, tree: Tree, comparable: bool) -> Result<u64, CmdError> {
        let scans = self.scans();
        let root = tree.name(0);
        if scans.running_first_scan(root) || (scans.running_full_scan(root) && !self.has_root(root))
        {
            return Err(CmdError::Busy);
        }
        let (generation, old) = self
            .install_scan(
                Arc::new(tree),
                &std::sync::atomic::AtomicBool::new(false),
                comparable,
            )
            .expect("not discarded");
        drop(scans);
        if let Some(old) = old {
            std::thread::spawn(move || drop(old));
        }
        Ok(generation)
    }

    pub fn refuse_cached(&self, root: &str) -> Result<(), CmdError> {
        let scans = self.scans();
        if scans.running_first_scan(root) || (scans.running_full_scan(root) && !self.has_root(root))
        {
            return Err(CmdError::Busy);
        }
        Ok(())
    }

    /// Removes only this job's provisional tree. A cached tree opened meanwhile is preserved.
    pub fn abort_live(&self, scan: u64) {
        let removed = {
            let mut data = self.write_data();
            data.roots
                .iter()
                .position(|r| r.scan == scan && r.tree.node(0).has(flags::SCANNING))
                .map(|at| data.roots.remove(at))
        };
        drop(removed);
    }

    /// Read the path before checking the queue; never retake the data lock with an Arc<Tree>.
    pub fn refuse_full_scan(&self, generation: u64) -> Result<(), CmdError> {
        let root = {
            let data = self.read_data();
            data.roots
                .iter()
                .find(|r| r.generation == generation)
                .map(|r| r.tree.name(0).to_owned())
                .ok_or(CmdError::StaleId)?
        };
        if self.scans().full_scan_contains(&root, true) {
            return Err(CmdError::Busy);
        }
        Ok(())
    }
}
