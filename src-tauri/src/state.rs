//! App state shared by all commands. Every tree read names its root by generation and checks
//! the node id.

use std::mem;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use sizeatlas_core::baseline::Baseline;
use sizeatlas_core::tree::{ListOrder, Tree};

use crate::details::MAX_DETAILS;
use crate::dto::{CrumbDto, RootsDto, Summary};
use crate::error::CmdError;
use crate::queue::ScanQueue;

/// A scanned or loaded root. Its generation names the root and this version of its tree.
struct OpenRoot {
    generation: u64,
    /// The generation the tree got when its scan or saved scan was installed. A compaction gives
    /// the tree a new generation but keeps this, so a refresh queued before it finds its tree.
    scan: u64,
    // Shared so that reads and cache writes need the lock only to find the tree. A change (a
    // folder refresh, a trash) takes `&mut` under the write lock once no read holds the tree
    // (see `change::tree_mut`); the tree is never copied.
    tree: Arc<Tree>,
    /// The tree compared with the full scan before the last one, indexed by the ids of this
    /// generation; `None` until computed (see `crate::baseline`) or when there is none.
    baseline: Option<Arc<Baseline>>,
    /// Counts the changes of `baseline`, so the UI fetches it again; the tree's `rev` stays.
    baseline_rev: u64,
    /// `baseline` is being computed again (`crate::baseline::refresh` follows): `None` until then.
    baseline_pending: bool,
}

struct Data {
    /// The last generation handed out. Never reused, so the ids of a replaced or closed tree
    /// stay stale.
    generation: u64,
    /// In the order of the folder tree.
    roots: Vec<OpenRoot>,
}

impl Data {
    /// Index of the open root with the canonical path `root`. The one comparison used to
    /// replace and to close a root.
    fn find(&self, root: &str) -> Option<usize> {
        self.roots.iter().position(|r| r.tree.name(0) == root)
    }
}

pub struct Shared {
    data: RwLock<Data>,
    /// The running scan and the roots waiting for it. Taken before `data` when both are needed.
    scans: Mutex<ScanQueue>,
    /// Held while a saved scan is written, deleted or read (see `begin_write`); closing waits
    /// for it.
    pub busy: Arc<tokio::sync::Mutex<()>>,
    /// See `exit.rs`.
    pub exit: AtomicU8,
    /// Stop asked for the running trash request (see `AppState::stop_trash`).
    pub trash_stop: AtomicBool,
}

#[derive(Clone)]
pub struct AppState(pub Arc<Shared>);

impl Default for AppState {
    fn default() -> Self {
        AppState(Arc::new(Shared {
            data: RwLock::new(Data {
                generation: 0,
                roots: Vec::new(),
            }),
            busy: Arc::new(tokio::sync::Mutex::new(())),
            scans: Mutex::default(),
            exit: AtomicU8::new(crate::exit::RUNNING),
            trash_stop: AtomicBool::new(false),
        }))
    }
}

impl AppState {
    fn read_data(&self) -> RwLockReadGuard<'_, Data> {
        self.0.data.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write_data(&self) -> RwLockWriteGuard<'_, Data> {
        self.0.data.write().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn scans(&self) -> MutexGuard<'_, ScanQueue> {
        self.0.scans.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Adds a tree at the end, or replaces the tree of the same root in place, and returns its
    /// new generation.
    #[cfg(test)]
    pub fn install_tree(&self, tree: Tree) -> u64 {
        let (generation, _replaced) = self
            .install_scan(Arc::new(tree), &AtomicBool::new(false), true)
            .expect("not discarded");
        generation
    }

    /// Like `install_tree`, unless `discard` is set: then nothing changes. `discard` is read
    /// under the write lock, and closing a root sets it before removing the root, so a scan
    /// that ends meanwhile cannot bring a closed root back. Returns the replaced tree for the
    /// caller to drop outside any lock (dropping millions of nodes takes a while). The caller
    /// then computes the baseline (`crate::baseline`), which is pending until then if
    /// `comparable` (see `crate::baseline::comparable`).
    pub fn install_scan(
        &self,
        tree: Arc<Tree>,
        discard: &AtomicBool,
        comparable: bool,
    ) -> Option<(u64, Option<Arc<Tree>>)> {
        let mut data = self.write_data();
        if discard.load(Ordering::Relaxed) {
            return None;
        }
        data.generation += 1;
        let generation = data.generation;
        let at = data.find(tree.name(0));
        let root = OpenRoot {
            generation,
            scan: generation,
            tree,
            baseline: None,
            baseline_rev: 0,
            // The caller computes it (`crate::baseline`).
            baseline_pending: comparable,
        };
        let replaced = match at {
            Some(i) => Some(mem::replace(&mut data.roots[i], root).tree),
            None => {
                data.roots.push(root);
                None
            }
        };
        Some((generation, replaced))
    }

    /// Removes the open root with the canonical path `root` from memory; its saved scan stays.
    /// The tree is dropped after the lock is released.
    pub fn close_path(&self, root: &str) -> bool {
        let removed = {
            let mut data = self.write_data();
            let at = data.find(root);
            at.map(|i| data.roots.remove(i))
        };
        removed.is_some()
    }

    /// The open roots and the scan queue.
    pub fn roots(&self) -> RootsDto {
        // The queue lock is let go before the data lock is taken: a change holds the data lock
        // while it waits for reads.
        let queue = self.scans().entries();
        RootsDto {
            roots: self.summaries(),
            queue,
        }
    }

    /// Summaries of the open roots, in the order of the folder tree.
    pub fn summaries(&self) -> Vec<Summary> {
        self.read_data()
            .roots
            .iter()
            .map(|r| {
                let baseline = r.baseline.as_deref();
                Summary::of(
                    r.generation,
                    &r.tree,
                    baseline,
                    r.baseline_rev,
                    r.baseline_pending,
                )
            })
            .collect()
    }

    pub fn summary(&self, generation: u64) -> Result<Summary, CmdError> {
        let (baseline, rev, pending) = self.compared(generation);
        self.with_tree(generation, |tree| {
            Summary::of(generation, tree, baseline.as_deref(), rev, pending)
        })
    }

    /// The tree of the root with `generation`; the lock is held only to find it.
    pub fn tree(&self, generation: u64) -> Result<Arc<Tree>, CmdError> {
        self.read_data()
            .roots
            .iter()
            .find(|r| r.generation == generation)
            .map(|r| r.tree.clone())
            .ok_or(CmdError::StaleId)
    }

    /// The baseline of the root with `generation`, if it has one. Indexed by the ids of that
    /// generation, but a refresh adds ids it does not have until it is computed again.
    pub fn baseline(&self, generation: u64) -> Option<Arc<Baseline>> {
        self.read_data()
            .roots
            .iter()
            .find(|r| r.generation == generation)
            .and_then(|r| r.baseline.clone())
    }

    /// How often the baseline of the root with `generation` changed.
    #[cfg(test)]
    pub fn baseline_rev(&self, generation: u64) -> Option<u64> {
        self.read_data()
            .roots
            .iter()
            .find(|r| r.generation == generation)
            .map(|r| r.baseline_rev)
    }

    /// The generation and the tree of the open root with the canonical path `root`.
    pub fn root_tree(&self, root: &str) -> Option<(u64, Arc<Tree>)> {
        let data = self.read_data();
        data.find(root)
            .map(|i| (data.roots[i].generation, data.roots[i].tree.clone()))
    }

    /// Runs `f` on the tree of the root with `generation`.
    fn with_tree<T>(&self, generation: u64, f: impl FnOnce(&Tree) -> T) -> Result<T, CmdError> {
        let tree = self.tree(generation)?;
        Ok(f(&tree))
    }

    /// Runs `f` on the tree of the root with `generation` if `id` is a live node in it.
    fn with_live<T>(
        &self,
        generation: u64,
        id: u32,
        f: impl FnOnce(&Tree) -> T,
    ) -> Result<T, CmdError> {
        self.with_tree(generation, |tree| tree.get(id).map(|_| f(tree)))?
            .ok_or(CmdError::StaleId)
    }

    /// Real paths of the first [`MAX_DETAILS`] ids; `None` for ids that are not live
    /// or whose path is inexact. Reading them happens later, without the lock.
    pub fn detail_paths(
        &self,
        generation: u64,
        ids: &[u32],
    ) -> Result<Vec<(u32, Option<PathBuf>)>, CmdError> {
        self.with_tree(generation, |tree| {
            ids.iter()
                .take(MAX_DETAILS)
                .map(|&id| {
                    let exact = tree.get(id).is_some() && !tree.has_lossy_path(id);
                    (id, exact.then(|| tree.path(id)))
                })
                .collect()
        })
    }

    /// Ancestors of `id` with their ranks among siblings listed by `order` (default: the tree's).
    pub fn crumbs(
        &self,
        generation: u64,
        id: u32,
        order: Option<ListOrder>,
    ) -> Result<Vec<CrumbDto>, CmdError> {
        let order = order.unwrap_or(ListOrder::FOLDERS);
        self.with_live(generation, id, |tree| {
            tree.crumbs(id)
                .into_iter()
                .map(|c| CrumbDto {
                    id: c,
                    name: tree.name(c).to_owned(),
                    size: tree.node(c).size,
                    rank: tree.rank_in(c, order),
                })
                .collect()
        })
    }
}

mod change;
mod charts;
mod growth;
mod lists;
mod live;
mod paths;
mod trash;

pub use self::trash::{TrashItem, Trashed, settle_parent};

#[cfg(test)]
mod tests;
