//! What a trash request names, checked against the tree, and the tree once the items are gone.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use sizeatlas_core::tree::{Tree, VolumeUsage, flags};

use super::AppState;
use crate::dto::TrashPreviewDto;
use crate::error::CmdError;

/// Full paths the confirmation of a trash request lists; the others are counted.
const PREVIEW_PATHS: usize = 10;

/// An item to move to the trash, as the scan saw it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrashItem {
    pub id: u32,
    pub path: PathBuf,
    pub is_dir: bool,
    /// Modification time when scanned: the item on disk must still have it.
    pub mtime: i64,
    /// Size on disk, for the confirmation.
    pub size: u64,
    /// Logical length: a cloud placeholder or a compressed file takes less on disk, but the trash
    /// limit is checked against the larger of the two.
    pub len: u64,
    pub parent: u32,
    pub parent_path: PathBuf,
    /// Modification time of the parent the tree had when the request was planned.
    pub parent_mtime: i64,
}

/// The items of one trash request by id, without those inside another item of it.
#[derive(Clone, Debug)]
pub struct TrashPlan {
    /// Canonical root of the tree.
    pub root: String,
    pub scanned_at: i64,
    pub items: Vec<TrashItem>,
}

/// An item that went to the trash, with the time of its folder just before and just after.
#[derive(Clone, Copy, Debug)]
pub struct Trashed {
    pub id: u32,
    pub parent: u32,
    /// The folder's own time just before.
    pub parent_before: Option<i64>,
    /// Its time in the listing of its own parent just before, read only when the own time was
    /// not the one planned with (on Windows the listing can lag behind the folder).
    pub parent_listed: Option<i64>,
    pub parent_after: Option<i64>,
}

impl AppState {
    /// Asks the running trash request to stop before its next item; the items moved stay moved.
    pub fn stop_trash(&self) {
        self.0.trash_stop.store(true, Ordering::Release);
    }

    pub fn trash_stopped(&self) -> bool {
        self.0.trash_stop.load(Ordering::Acquire)
    }

    /// A new trash request starts unstopped: called before it waits for `begin_write`, so a stop
    /// asked while it waits still counts.
    pub fn reset_trash_stop(&self) {
        self.0.trash_stop.store(false, Ordering::Release);
    }

    /// The items `ids` of the tree with `generation` at revision `rev`. `StaleId` unless every id
    /// is a live node of that very revision and none is the root (a first scan's tree changes its
    /// revision all the time but keeps its ids: any revision of it will do); `LossyName` when a
    /// path is not exact; `Busy` when a scan still lists an item (see `trash_refused`). An item
    /// inside another one of the list is left out: it goes with that one.
    pub fn trash_plan(
        &self,
        generation: u64,
        rev: u64,
        ids: &[u32],
    ) -> Result<TrashPlan, CmdError> {
        // Before the tree is read: never the queue lock while a read holds the tree.
        let running = self.scans().running_job();
        let tree = self.tree(generation)?;
        let wanted = wanted_ids(&tree, rev, ids)?;
        let mut items = Vec::new();
        let mut unfinished = false;
        for &id in &wanted {
            let chain = tree.crumbs(id);
            if chain[..chain.len() - 1].iter().any(|a| wanted.contains(a)) {
                continue;
            }
            if tree.has_lossy_path(id) {
                return Err(CmdError::LossyName);
            }
            unfinished |= during_scan::unfinished(&tree, id);
            let node = tree.node(id);
            items.push(TrashItem {
                id,
                path: tree.path(id),
                is_dir: node.is_dir(),
                mtime: node.mtime,
                size: node.size,
                len: node.len,
                parent: node.parent,
                parent_path: tree.path(node.parent),
                parent_mtime: tree.node(node.parent).mtime,
            });
        }
        let plan = TrashPlan {
            root: tree.name(0).to_owned(),
            scanned_at: tree.scanned_at,
            items,
        };
        let refused = |i: &TrashItem| {
            running
                .as_ref()
                .is_some_and(|job| job.refuses_trash(&i.path, &plan.root))
        };
        if unfinished || plan.items.iter().any(refused) {
            return Err(CmdError::Busy);
        }
        Ok(plan)
    }

    /// What a trash request would move, for its confirmation.
    pub fn trash_preview(
        &self,
        generation: u64,
        rev: u64,
        ids: &[u32],
    ) -> Result<TrashPreviewDto, CmdError> {
        let plan = self.trash_plan(generation, rev, ids)?;
        Ok(TrashPreviewDto {
            count: plan.items.len() as u32,
            size: plan.items.iter().map(|i| i.size).sum(),
            scanned_at: plan.scanned_at,
            paths: plan
                .items
                .iter()
                .take(PREVIEW_PATHS)
                .map(|i| i.path.display().to_string())
                .collect(),
        })
    }

    /// Takes the items that went to the trash out of the tree with `generation` and gives their
    /// folders the time they have now, but only a folder whose time just before (its own, or
    /// as its parent listed it) was the one the tree knew: a folder changed outside SizeAtlas
    /// keeps its old time, so moving it to the trash later still fails the check. Returns the
    /// changed tree, to save; `None` if the root was closed or replaced meanwhile.
    pub fn remove_trashed(
        &self,
        generation: u64,
        trashed: &[Trashed],
        volume: Option<VolumeUsage>,
    ) -> Option<Arc<Tree>> {
        self.change_tree(generation, |tree| {
            for t in trashed {
                if tree.get(t.id).is_some() {
                    tree.remove(t.id);
                }
                settle_parent(
                    tree,
                    t.parent,
                    [t.parent_before, t.parent_listed],
                    t.parent_after,
                );
            }
            tree.volume = volume;
            Some(())
        })
    }
}

/// Gives the live folder `parent` of an item that went to the trash its time `after`, but only
/// if its time just before (`before`: its own, or as its parent listed it) is the one the tree
/// knows: a folder changed outside SizeAtlas keeps its old time, so moving it to the trash later
/// still fails the check.
pub fn settle_parent(tree: &mut Tree, parent: u32, before: [Option<i64>; 2], after: Option<i64>) {
    let known = tree.get(parent).map(|p| p.mtime);
    if let Some(after) = after
        && known.is_some()
        && before.contains(&known)
    {
        tree.set_mtime(parent, after);
    }
}

/// `ids` as a set, if every one is a live node other than the root of `tree` at revision `rev`
/// (any revision of a first scan's tree: it keeps its ids); else `StaleId`.
fn wanted_ids(tree: &Tree, rev: u64, ids: &[u32]) -> Result<BTreeSet<u32>, CmdError> {
    let wanted: BTreeSet<u32> = ids.iter().copied().collect();
    let known = |id: u32| id != 0 && tree.get(id).is_some();
    let live = tree.node(0).has(flags::SCANNING);
    if (tree.rev != rev && !live) || wanted.is_empty() || !wanted.iter().all(|&id| known(id)) {
        return Err(CmdError::StaleId);
    }
    Ok(wanted)
}

mod during_scan;
#[cfg(test)]
mod tests;
