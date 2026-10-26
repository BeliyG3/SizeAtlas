//! Changes to an open tree in place: a refreshed folder, items moved to the trash. Also a new
//! baseline, which leaves the tree as it is.

use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use sizeatlas_core::baseline::Baseline;
use sizeatlas_core::tree::Tree;
use sizeatlas_core::tree::flags::SCANNING;

use super::{AppState, OpenRoot};
use crate::error::CmdError;
use crate::queue::FolderTarget;

/// How long a change waits between checks for reads that still hold the tree.
const READ_WAIT: Duration = Duration::from_millis(1);
/// A change that waits this long for reads says so: a read that never ends is a bug.
const READ_WARN: Duration = Duration::from_secs(5);

impl AppState {
    /// Runs `change` on the tree of the root with `generation`, as `change_scan` does for a scan.
    /// A trash asks for the very tree it checked its items in.
    pub fn change_tree(
        &self,
        generation: u64,
        change: impl FnOnce(&mut Tree) -> Option<()>,
    ) -> Option<Arc<Tree>> {
        self.change_where(
            |r| r.generation == generation,
            false,
            |tree, _| change(tree),
        )
    }

    /// Runs `change` on the tree of the scan `scan` (see `OpenRoot::scan`), in place, under the
    /// write lock; `change` also gets the generation the tree has now and returns `None` when it
    /// changed nothing. After a change, a tree with more dead nodes than live ones is compacted
    /// and gets a new generation. Returns the changed tree, to save; `None` when nothing changed
    /// or the root was rescanned or closed. After a compaction of a root that has a baseline or
    /// waits for one, the caller computes it again (`crate::baseline`): it is pending until then.
    /// The change that ends a first scan goes through `end_scan`.
    pub fn change_scan(
        &self,
        scan: u64,
        change: impl FnOnce(&mut Tree, u64) -> Option<()>,
    ) -> Option<Arc<Tree>> {
        self.change_where(|r| r.scan == scan, false, change)
    }

    /// `change_scan` for the change that ends a first scan. Its baseline is pending afterwards
    /// only when `comparable` (see `crate::baseline::comparable`): the caller computes it.
    pub fn end_scan(
        &self,
        scan: u64,
        comparable: bool,
        change: impl FnOnce(&mut Tree) -> Option<()>,
    ) -> Option<Arc<Tree>> {
        self.change_where(|r| r.scan == scan, comparable, |tree, _| change(tree))
    }

    fn change_where(
        &self,
        find: impl Fn(&OpenRoot) -> bool,
        comparable: bool,
        change: impl FnOnce(&mut Tree, u64) -> Option<()>,
    ) -> Option<Arc<Tree>> {
        let (changed, old) = {
            let mut data = self.write_data();
            let at = data.roots.iter().position(find)?;
            let generation = data.roots[at].generation;
            let tree = tree_mut(&mut data.roots[at].tree);
            let was_scanning = tree.node(0).has(SCANNING);
            change(tree, generation)?;
            let scanning = tree.node(0).has(SCANNING);
            // FolderGone removes a listed folder during a first scan. Keep the remaining ids
            // stable until the scan finishes; only then may compaction renumber them.
            let old = (tree.dead > tree.live && !scanning).then(|| tree.compact());
            if old.is_some() {
                data.generation += 1;
                data.roots[at].generation = data.generation;
            }
            // Indexed by the old ids, or none yet; with nothing to compare with, nothing comes.
            let root = &mut data.roots[at];
            let compare = if was_scanning && !scanning {
                comparable
            } else {
                old.is_some() && (root.baseline.is_some() || root.baseline_pending)
            };
            if compare {
                root.compare_again();
            }
            (data.roots[at].tree.clone(), old)
        };
        // Dropping millions of nodes takes a while: neither under the lock nor before closing.
        if let Some(old) = old {
            thread::spawn(move || drop(old));
        }
        Some(changed)
    }

    /// Gives the root with `generation` the baseline computed from its tree at revision `rev`,
    /// which is no longer pending; a change of either gets a new `baseline_rev`, the tree stays
    /// as it is. Returns whether it changed, or `None` when the tree changed meanwhile: the
    /// baseline is computed again.
    pub fn set_baseline(
        &self,
        generation: u64,
        rev: u64,
        baseline: Option<Arc<Baseline>>,
    ) -> Option<bool> {
        let mut data = self.write_data();
        let root = data
            .roots
            .iter_mut()
            .find(|r| r.generation == generation && r.tree.rev == rev)?;
        let changed = root.baseline.is_some() || baseline.is_some() || root.baseline_pending;
        if changed {
            root.baseline = baseline;
            root.baseline_rev += 1;
            root.baseline_pending = false;
        }
        Some(changed)
    }

    /// The root of `id` and what to queue to refresh it: its folder (a file's own folder), or
    /// `None` — a full scan — for the root.
    pub fn refresh_target(
        &self,
        generation: u64,
        id: u32,
    ) -> Result<(String, Option<FolderTarget>), CmdError> {
        self.refuse_full_scan(generation)?;
        let scan = self
            .read_data()
            .roots
            .iter()
            .find(|r| r.generation == generation)
            .map(|r| r.scan)
            .ok_or(CmdError::StaleId)?;
        let tree = self.tree(generation)?;
        let node = tree.get(id).ok_or(CmdError::StaleId)?;
        let folder = if node.is_dir() { id } else { node.parent };
        if tree.has_lossy_path(folder) {
            return Err(CmdError::LossyName);
        }
        let target = (folder != 0).then(|| FolderTarget {
            scan,
            generation,
            id: folder,
            path: tree.path(folder),
        });
        Ok((tree.name(0).to_owned(), target))
    }

    /// `id` if it is alive, else its nearest live ancestor: where a view of a removed node goes.
    pub fn live_ancestor(&self, generation: u64, id: u32) -> Result<u32, CmdError> {
        let tree = self.tree(generation)?;
        if id as usize >= tree.len() {
            return Err(CmdError::StaleId);
        }
        Ok(tree.live_ancestor(id))
    }
}

impl OpenRoot {
    /// Drops the baseline until the caller computes it again.
    fn compare_again(&mut self) {
        self.baseline = None;
        self.baseline_pending = true;
        self.baseline_rev += 1;
    }
}

/// `&mut` to a shared tree without copying it: waits until no read holds it. The caller holds
/// the write lock, so no new read can take the tree meanwhile, and every read waits: nobody may
/// hold an `Arc<Tree>` for long outside the write of its root (long work on a tree, such as
/// computing its baseline, holds that write, which a trash and every saved scan of the root also
/// take). Exceptions without the write: the batches of a live first scan (`change_scan` in
/// `worker/live.rs`), `close_path`, and `plan_rows`/`trash_plan` when a trash is confirmed (a
/// short read of the `Arc`).
// ponytail: the clean-up walk of a confirmation (about 0.6 s) may delay `tree_mut` of the same
// root; walk a copy of the rows if that delay shows.
// ponytail: a read that took the data lock again while holding the tree would make this wait
// forever; none does: reads take the lock only to clone the `Arc`, and `crate::baseline` drops
// its tree before `set_baseline`. Keep it that way. After READ_WARN the wait is reported on
// stderr.
fn tree_mut(tree: &mut Arc<Tree>) -> &mut Tree {
    let start = Instant::now();
    let mut warned = false;
    while Arc::get_mut(tree).is_none() {
        if !warned && start.elapsed() >= READ_WARN {
            eprintln!("SizeAtlas: a change has waited {READ_WARN:?} for reads of the tree");
            warned = true;
        }
        thread::sleep(READ_WAIT);
    }
    Arc::get_mut(tree).expect("no read holds the tree")
}
