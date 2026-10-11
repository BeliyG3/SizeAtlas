//! Per-subtree summaries for the side panels: space by file type.

use super::{Node, Tree};
use crate::categories::Category;

/// Files of one category in a subtree.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TypeStat {
    pub files: u64,
    pub size: u64,
}

impl Tree {
    /// Live files below `id` (or `id` itself if it is a file) by category;
    /// the index is `Category as usize`.
    // ponytail: walks the subtree on every call (about 0.1 s for 8 million nodes);
    // precompute per folder if the panel feels slow.
    pub fn type_stats(&self, id: u32) -> [TypeStat; Category::ALL.len()] {
        let mut stats = [TypeStat::default(); Category::ALL.len()];
        self.for_each_file(id, |_, node| {
            let stat = &mut stats[usize::from(node.category)];
            stat.files += 1;
            stat.size = stat.size.saturating_add(node.size);
        });
        stats
    }

    /// Calls `f` for every live file in the subtree of `id`, without recursion.
    fn for_each_file(&self, id: u32, mut f: impl FnMut(u32, &Node)) {
        let mut dirs = vec![id];
        while let Some(dir) = dirs.pop() {
            let node = &self.nodes[dir as usize];
            if !node.is_dir() {
                f(dir, node);
                continue;
            }
            for child in self.children(dir) {
                let n = &self.nodes[child as usize];
                if n.is_dir() {
                    dirs.push(child);
                } else {
                    f(child, n);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
