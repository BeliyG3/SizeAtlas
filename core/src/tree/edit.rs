//! Changes to a tree in place: a refreshed folder, removed items and compaction. Ids of live
//! nodes stay the same until `compact`, which renumbers them; a dead node keeps its parent, so a
//! view of it can find its nearest live ancestor.

use std::mem;
use std::ops::Sub;
use std::path::Path;

use super::{DirRec, NO_PARENT, Node, Tree, flags};

/// What a node adds to the totals of every ancestor.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Totals {
    size: u64,
    files: u32,
    len: u64,
    /// The node itself if it is a folder, and the folders below it.
    dirs: u32,
}

impl Totals {
    pub(super) fn of(node: &Node) -> Totals {
        Totals {
            size: node.size,
            files: node.files,
            len: node.len,
            dirs: node.dirs + u32::from(node.is_dir()),
        }
    }
}

/// The nodes one change marked dead.
#[derive(Default)]
pub(super) struct Killed {
    pub(super) count: u32,
    /// Unreadable folders among them: `Tree::access_errors` counts those that are alive.
    pub(super) access_errors: u32,
    pub(super) hardlink: bool,
}

impl Tree {
    /// Replaces what folder `id` holds with a fresh scan of it: `records` as a scanner sends
    /// them for that folder (record 0 is the folder itself; its name is not used). The folder
    /// keeps its id and takes its time and flags from record 0; its old contents die; every
    /// ancestor gets the difference.
    ///
    /// # Panics
    /// If `id` is the root (a full scan replaces it), or not a live folder.
    pub fn replace_subtree(&mut self, id: u32, records: Vec<DirRec>) {
        let meta = super::ScanMeta {
            cluster: self.cluster,
            size_mode: self.size_mode,
            scanned_at: self.scanned_at,
        };
        self.graft(id, Tree::from_records(records, meta));
    }

    /// Takes `id` and everything below it out of its ancestors' totals and marks them dead.
    /// The parent's `child_count` stays: every walk skips dead nodes.
    ///
    /// # Panics
    /// If `id` is the root or dead.
    pub fn remove(&mut self, id: u32) {
        assert_ne!(id, 0, "the root cannot be removed");
        assert!(
            self.nodes[id as usize].is_alive(),
            "only a live node is removed"
        );
        let gone = Totals::of(&self.nodes[id as usize]);
        let mut killed = self.kill_below(id);
        let node = &mut self.nodes[id as usize];
        node.flags &= !flags::ALIVE;
        killed.count += 1;
        killed.hardlink |= node.has(flags::HARDLINK);
        killed.access_errors += u32::from(node.has(flags::ACCESS_ERROR));
        self.live = less(self.live, killed.count);
        self.dead += killed.count;
        self.access_errors = less(self.access_errors, killed.access_errors);
        self.update_ancestors(id, gone, Totals::default());
        self.changed(killed.hardlink);
    }

    /// Sets the modification time of `id`: the folder of an item that went to the trash.
    pub fn set_mtime(&mut self, id: u32, mtime: i64) {
        self.nodes[id as usize].mtime = mtime;
    }

    /// Copy containing only live nodes, renumbered breadth-first. The tree itself is unchanged.
    /// The reference that `compact` is tested against.
    #[cfg(test)]
    pub fn compact_snapshot(&self) -> Tree {
        let nodes = renumber(self.live as usize, |id| {
            let node = &self.nodes[id as usize];
            node.is_alive().then(|| node.clone())
        });
        self.with_nodes(nodes)
    }

    /// Drops the dead nodes in place and renumbers the live ones breadth-first: they move into
    /// the new block, none is copied. Every id changes, so the caller gives the tree a new
    /// generation. Returns the old tree with its dead nodes, to drop outside any lock (millions of
    /// nodes take a while).
    pub fn compact(&mut self) -> Tree {
        let mut old = mem::take(&mut self.nodes);
        let nodes = renumber(self.live as usize, |id| {
            let node = &mut old[id as usize];
            node.is_alive().then(|| mem::take(node))
        });
        let compacted = self.with_nodes(nodes);
        let mut previous = mem::replace(self, compacted);
        previous.nodes = old;
        previous
    }

    /// `id` if it is alive, else its nearest live ancestor (the root at worst). `id` must be in
    /// bounds.
    pub fn live_ancestor(&self, id: u32) -> u32 {
        let mut at = id;
        while !self.nodes[at as usize].is_alive() {
            at = self.nodes[at as usize].parent;
        }
        at
    }

    /// The live node at `path`, which starts with the path of the root; `None` if a name on the
    /// way is not there or the path is not below the root.
    pub fn find_path(&self, path: &Path) -> Option<u32> {
        let below = path.strip_prefix(self.name(0)).ok()?;
        below.components().try_fold(0, |at, part| {
            let name = part.as_os_str().to_str()?;
            self.children(at).find(|&c| self.name(c) == name)
        })
    }

    /// Marks every live node below `id` dead, without recursion; `id` itself stays.
    pub(super) fn kill_below(&mut self, id: u32) -> Killed {
        let mut killed = Killed::default();
        let mut stack: Vec<u32> = self.children(id).collect();
        while let Some(at) = stack.pop() {
            let node = &mut self.nodes[at as usize];
            node.flags &= !flags::ALIVE;
            killed.count += 1;
            killed.hardlink |= node.has(flags::HARDLINK);
            killed.access_errors += u32::from(node.has(flags::ACCESS_ERROR));
            if node.is_dir() {
                stack.extend(self.children(at));
            }
        }
        killed
    }

    /// Moves the totals of every ancestor of `id` from `old` to `new`.
    pub(super) fn update_ancestors(&mut self, id: u32, old: Totals, new: Totals) {
        let mut at = self.nodes[id as usize].parent;
        while at != NO_PARENT {
            let n = &mut self.nodes[at as usize];
            n.size = less(n.size, old.size) + new.size;
            n.files = less(n.files, old.files) + new.files;
            n.len = less(n.len, old.len) + new.len;
            n.dirs = less(n.dirs, old.dirs) + new.dirs;
            at = n.parent;
        }
    }

    /// One change happened: a new revision; hard links make sizes approximate until a full scan.
    pub(super) fn changed(&mut self, hardlink: bool) {
        self.rev += 1;
        self.approximate |= hardlink;
    }

    /// A tree with the facts of this one and `nodes`, all of them alive.
    fn with_nodes(&self, nodes: Vec<Node>) -> Tree {
        Tree {
            live: nodes.len() as u32,
            dead: 0,
            nodes,
            rev: self.rev,
            cluster: self.cluster,
            size_mode: self.size_mode,
            approximate: self.approximate,
            access_errors: self.access_errors,
            scanned_at: self.scanned_at,
            volume: self.volume,
        }
    }
}

/// The live nodes, renumbered breadth-first from the root, so a folder's children stay one
/// block; `take(id)` gives node `id` if it is alive: a copy, or the node itself.
fn renumber(capacity: usize, mut take: impl FnMut(u32) -> Option<Node>) -> Vec<Node> {
    let mut nodes = Vec::with_capacity(capacity);
    nodes.extend(take(0));
    // New ids are handed out breadth-first, so walking them in order is the breadth-first walk.
    let mut at = 0;
    while at < nodes.len() {
        if nodes[at].is_dir() {
            let (first, count) = (nodes[at].first_child, nodes[at].child_count);
            let start = nodes.len() as u32;
            for old in first..first + count {
                if let Some(mut child) = take(old) {
                    child.parent = at as u32;
                    nodes.push(child);
                }
            }
            let count = nodes.len() as u32 - start;
            let folder = &mut nodes[at];
            folder.first_child = start;
            folder.child_count = count;
        }
        at += 1;
    }
    nodes
}

/// Saturating subtraction: older saved scans can have inconsistent counters.
pub(super) fn less<T: Copy + Default + PartialOrd + Sub<Output = T>>(a: T, b: T) -> T {
    if a >= b { a - b } else { T::default() }
}

#[cfg(test)]
mod oracle;
#[cfg(test)]
mod tests;
