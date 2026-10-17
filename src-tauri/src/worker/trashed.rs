//! Items that went to the trash while a full scan ran: its walk may have listed them before
//! they went (see `ScanJob::trashed`).

use std::fs;
use std::io;
use std::mem;
use std::path::PathBuf;
use std::sync::PoisonError;

use sizeatlas_core::tree::Tree;

use crate::queue::ScanJob;

/// The paths that went to the trash during `job` and are still gone. Reads the disk: call it
/// outside the data lock.
pub(super) fn gone(job: &ScanJob) -> Vec<PathBuf> {
    let paths = mem::take(&mut *job.trashed.lock().unwrap_or_else(PoisonError::into_inner));
    paths
        .into_iter()
        .filter(|p| fs::symlink_metadata(p).is_err_and(|e| e.kind() == io::ErrorKind::NotFound))
        .collect()
}

/// Takes the `gone` items out of `tree`, and out of their ancestors' totals.
pub(super) fn remove(tree: &mut Tree, gone: &[PathBuf]) {
    for path in gone {
        if let Some(id) = tree.find_path(path)
            && id != 0
        {
            tree.remove(id);
        }
    }
}
