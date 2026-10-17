//! Items that went to the trash while a full scan ran: its walk may have listed them before
//! they went (see `ScanJob::trashed`).

use std::fs;
use std::io;
use std::mem;
use std::sync::PoisonError;

use sizeatlas_core::tree::Tree;

use crate::queue::{ScanJob, TrashedPath};
use crate::state::settle_parent;

/// The items that went to the trash during `job` and are still gone. Reads the disk: call it
/// outside the data lock.
pub(super) fn gone(job: &ScanJob) -> Vec<TrashedPath> {
    let items = mem::take(&mut *job.trashed.lock().unwrap_or_else(PoisonError::into_inner));
    items
        .into_iter()
        .filter(|i| {
            fs::symlink_metadata(&i.path).is_err_and(|e| e.kind() == io::ErrorKind::NotFound)
        })
        .collect()
}

/// Takes the `gone` items out of `tree`, and out of their ancestors' totals; their folders get
/// the time they have since, as after any trash (see `settle_parent`).
pub(super) fn remove(tree: &mut Tree, gone: &[TrashedPath]) {
    for item in gone {
        if let Some(id) = tree.find_path(&item.path)
            && id != 0
        {
            let parent = tree.node(id).parent;
            tree.remove(id);
            settle_parent(tree, parent, item.parent_before, item.parent_after);
        }
    }
}
