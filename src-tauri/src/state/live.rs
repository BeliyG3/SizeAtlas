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

    /// Installs only if still absent, so opening a saved scan meanwhile wins. The job's discard
    /// flag is checked under the same lock as installation, as it is for a completed scan.
    pub fn start_live(&self, job: &ScanJob, tree: Tree) -> Option<u64> {
        let mut data = self.write_data();
        if job.cancelled()
            || job.discard.load(Ordering::Relaxed)
            || self.closing()
            || data.find(tree.name(0)).is_some()
        {
            return None;
        }
        data.generation += 1;
        let generation = data.generation;
        data.roots.push(OpenRoot {
            generation,
            scan: generation,
            tree: Arc::new(tree),
        });
        Some(generation)
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
