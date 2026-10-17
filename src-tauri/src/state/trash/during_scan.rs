//! What a running scan keeps from the trash, asked by the menus before a request.

use sizeatlas_core::tree::{Tree, flags};

use super::wanted_ids;
use crate::error::CmdError;
use crate::state::AppState;

/// Whether `id` is a folder a first scan has not finished, or lies in one.
pub(super) fn unfinished(tree: &Tree, id: u32) -> bool {
    tree.crumbs(id)[1..]
        .iter()
        .any(|&a| tree.node(a).flags & (flags::PENDING | flags::SCANNING) != 0)
}

impl AppState {
    /// Whether a scan keeps one of `ids` from going to the trash now, by the rule of
    /// `trash_plan`: a folder a first scan has not finished, a refreshed folder or one above it,
    /// a scanned root or one above it, anything of another open tree inside a first scan (see
    /// `ScanJob::refuses_trash`). Paths are built only while a job runs.
    pub fn trash_refused(&self, generation: u64, rev: u64, ids: &[u32]) -> Result<bool, CmdError> {
        let running = self.scans().running_job();
        let tree = self.tree(generation)?;
        let wanted = wanted_ids(&tree, rev, ids)?;
        if wanted.iter().any(|&id| unfinished(&tree, id)) {
            return Ok(true);
        }
        let Some(job) = running else {
            return Ok(false);
        };
        let root = tree.name(0);
        Ok(wanted
            .iter()
            .any(|&id| job.refuses_trash(&tree.path(id), root)))
    }
}
