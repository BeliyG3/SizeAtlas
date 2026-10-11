//! Structural validation of a tree that may come from untrusted bytes.

use super::{NO_PARENT, Tree};
use crate::categories::{Category, DIR_CATEGORY};

impl Tree {
    /// Validates every index and counter so that a tree read from untrusted bytes
    /// cannot cause panics, out-of-bounds access, overflow or endless loops in
    /// [`Tree::children`], [`Tree::path`] or [`Tree::compact`].
    ///
    /// Guarantees on success: node ids fit in `u32`; every child block lies inside the
    /// node vector, after its directory, and belongs to a directory; the child blocks of
    /// live directories are disjoint; every non-root node has a smaller parent id; every
    /// live node sits in the block of its live parent directory; `live` and `dead` match
    /// the actual node counts.
    pub fn check_structure(&self) -> Result<(), &'static str> {
        let len = self.nodes.len() as u64;
        let root = self.nodes.first().ok_or("empty tree")?;
        if len > u64::from(u32::MAX) {
            return Err("too many nodes");
        }
        if root.parent != NO_PARENT || !root.is_dir() || !root.is_alive() {
            return Err("bad root");
        }
        let mut alive = 0u64;
        let mut blocks = Vec::new();
        for (i, n) in self.nodes.iter().enumerate() {
            let end = u64::from(n.first_child) + u64::from(n.child_count);
            if end > len {
                return Err("child block out of bounds");
            }
            if n.child_count > 0 {
                if !n.is_dir() {
                    return Err("file with children");
                }
                if (n.first_child as usize) <= i {
                    return Err("child block must follow its directory");
                }
            }
            let valid_category = if n.is_dir() {
                n.category == DIR_CATEGORY
            } else {
                usize::from(n.category) < Category::ALL.len()
            };
            if !valid_category {
                return Err("invalid category");
            }
            if i == 0 {
                alive += 1;
                continue;
            }
            if n.parent as usize >= i {
                return Err("parent must precede child");
            }
            if !n.is_alive() {
                continue;
            }
            alive += 1;
            let p = &self.nodes[n.parent as usize];
            let range =
                u64::from(p.first_child)..u64::from(p.first_child) + u64::from(p.child_count);
            if !p.is_alive() || !p.is_dir() || !range.contains(&(i as u64)) {
                return Err("node outside its parent's child block");
            }
        }
        for n in self
            .nodes
            .iter()
            .filter(|n| n.is_alive() && n.is_dir() && n.child_count > 0)
        {
            blocks.push((n.first_child, n.first_child + n.child_count));
        }
        blocks.sort_unstable();
        // With every live node inside its parent's block, disjoint blocks mean
        // no live node is listed as a child of a directory that is not its parent.
        if blocks.windows(2).any(|w| w[0].1 > w[1].0) {
            return Err("overlapping child blocks");
        }
        if u64::from(self.live) != alive || u64::from(self.live) + u64::from(self.dead) != len {
            return Err("node counters do not match");
        }
        Ok(())
    }
}
