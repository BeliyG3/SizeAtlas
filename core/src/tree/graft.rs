//! Moving a prebuilt batch into an existing folder without sorting or recounting records.

use super::edit::Totals;
use super::{Node, Tree, flags};

impl Tree {
    /// Allocates any needed growth buffer while readers can still use this tree.
    /// The live publisher serializes batches, so the node count cannot grow before adoption.
    pub fn graft_buffer(&self, additional: usize) -> Vec<Node> {
        let needed = self.nodes.len() + additional;
        if needed > self.nodes.capacity() {
            Vec::with_capacity(needed.max(self.nodes.capacity().saturating_mul(2)))
        } else {
            Vec::new()
        }
    }

    /// Adopts a buffer allocated before taking the shared data write lock.
    pub fn reserve_graft(&mut self, mut buffer: Vec<Node>) {
        if buffer.capacity() > self.nodes.capacity() {
            assert!(buffer.capacity() >= self.nodes.len());
            buffer.append(&mut self.nodes);
            self.nodes = buffer;
        }
    }

    /// Replaces a live non-root folder by moving a flattened subtree. Existing ids stay stable.
    pub fn graft(&mut self, id: u32, sub: Tree) {
        assert_ne!(id, 0, "the root is replaced by a full scan");
        let node = &self.nodes[id as usize];
        assert!(
            node.is_alive() && node.is_dir(),
            "only a live folder is replaced"
        );
        let old = Totals::of(node);
        let own_error = u32::from(node.has(flags::ACCESS_ERROR));
        let lossy = node.flags & flags::LOSSY_NAME;
        let killed = self.kill_below(id);
        self.live = self.live - killed.count + sub.live - 1;
        self.dead += killed.count;
        self.access_errors =
            self.access_errors - killed.access_errors - own_error + sub.access_errors;
        let base = self.nodes.len() as u32;
        self.nodes.reserve(sub.nodes.len() - 1);
        let mut incoming = sub.nodes.into_iter();
        let root = incoming.next().expect("subtree root");
        let node = &mut self.nodes[id as usize];
        node.first_child = base + root.first_child - 1;
        node.child_count = root.child_count;
        node.size = root.size;
        node.files = root.files;
        node.len = root.len;
        node.dirs = root.dirs;
        node.mtime = root.mtime;
        node.flags = root.flags | lossy;
        let mut hardlink = killed.hardlink;
        self.nodes.extend(incoming.map(|mut n| {
            n.parent = if n.parent == 0 {
                id
            } else {
                base + n.parent - 1
            };
            if n.is_dir() {
                n.first_child = base + n.first_child - 1;
            }
            hardlink |= n.has(flags::HARDLINK);
            n
        }));
        self.update_ancestors(id, old, Totals::of(&self.nodes[id as usize]));
        self.changed(hardlink);
    }
}

#[cfg(test)]
mod tests;
