//! Flat lists over a subtree for the contents table: the largest, oldest or newest items, empty
//! ones, unreadable folders and the longest paths.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use serde::Deserialize;

use super::{Node, Tree, flags};

/// What a list holds and in what order. A list never holds the node it is made for, nor dead
/// nodes; items with equal keys are ordered by id.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ListKind {
    /// Largest on disk first; a folder counts its whole subtree.
    LargestFiles,
    LargestFolders,
    Largest,
    /// Least recently modified first; items whose time is unknown (0) are left out.
    OldestFiles,
    OldestFolders,
    Oldest,
    /// Most recently modified first; items whose time is unknown (0) are left out.
    NewestFiles,
    NewestFolders,
    Newest,
    /// Folders without live children (unreadable ones are not empty) and files of length 0,
    /// by path.
    EmptyFolders,
    EmptyFiles,
    Empty,
    /// Folders that could not be read, by path.
    Unreadable,
    /// Files and folders by the length of their full path in characters, longest first.
    LongestPaths,
    /// Folders by their change since the previous full scan. Built by the app, which has the
    /// baseline; the tree lists nothing.
    GrewMost,
}

/// A list and whether more items matched than the limit allowed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListResult {
    pub items: Vec<u32>,
    pub truncated: bool,
}

#[derive(Clone, Copy)]
enum Items {
    Files,
    Folders,
    Both,
}

#[derive(Clone, Copy)]
enum Rank {
    Size,
    Oldest,
    Newest,
    /// Tree order, which is the order of the paths.
    Empty,
    /// Tree order too.
    Unreadable,
    Longest,
}

impl ListKind {
    fn parts(self) -> Option<(Items, Rank)> {
        use Items::{Both, Files, Folders};
        use ListKind as K;
        Some(match self {
            K::LargestFiles => (Files, Rank::Size),
            K::LargestFolders => (Folders, Rank::Size),
            K::Largest => (Both, Rank::Size),
            K::OldestFiles => (Files, Rank::Oldest),
            K::OldestFolders => (Folders, Rank::Oldest),
            K::Oldest => (Both, Rank::Oldest),
            K::NewestFiles => (Files, Rank::Newest),
            K::NewestFolders => (Folders, Rank::Newest),
            K::Newest => (Both, Rank::Newest),
            K::EmptyFolders => (Folders, Rank::Empty),
            K::EmptyFiles => (Files, Rank::Empty),
            K::Empty => (Both, Rank::Empty),
            K::Unreadable => (Folders, Rank::Unreadable),
            K::LongestPaths => (Both, Rank::Longest),
            K::GrewMost => return None,
        })
    }
}

impl Tree {
    /// Up to `limit` live nodes below `id` (not `id` itself) of `kind`, in its order.
    pub fn list(&self, id: u32, kind: ListKind, limit: usize) -> ListResult {
        let Some((items, rank)) = kind.parts() else {
            return ListResult {
                items: Vec::new(),
                truncated: false,
            };
        };
        let wanted = |n: &Node| match items {
            Items::Files => !n.is_dir(),
            Items::Folders => n.is_dir(),
            Items::Both => true,
        };
        let mut matched = 0usize;
        if let Rank::Empty | Rank::Unreadable = rank {
            let mut found = Vec::new();
            self.walk_below(id, false, |node, n, _| {
                let fits = match rank {
                    Rank::Empty => self.is_empty_item(node, n),
                    _ => n.has(flags::ACCESS_ERROR),
                };
                if wanted(n) && fits {
                    matched += 1;
                    if found.len() < limit {
                        found.push(node);
                    }
                }
            });
            return ListResult {
                items: found,
                truncated: matched > limit,
            };
        }
        // Min-heap of the best items so far: its top is the first to drop (the lowest score,
        // and of equal scores the largest id). Capacity is only a hint; a caller's huge
        // `limit` must not overflow or over-allocate.
        let mut heap = BinaryHeap::with_capacity(limit.min(self.len()));
        self.walk_below(id, matches!(rank, Rank::Longest), |node, n, chars| {
            if !wanted(n) {
                return;
            }
            let score = match rank {
                Rank::Size => i128::from(n.size),
                Rank::Oldest if n.mtime != 0 => -i128::from(n.mtime),
                Rank::Newest if n.mtime != 0 => i128::from(n.mtime),
                Rank::Longest => chars as i128,
                _ => return,
            };
            matched += 1;
            let entry = Reverse((score, Reverse(node)));
            if heap.len() < limit {
                heap.push(entry);
            } else if let Some(mut worst) = heap.peek_mut() {
                // A full heap only changes for an item that beats its worst one.
                if entry < *worst {
                    *worst = entry;
                }
            }
        });
        // Ascending order of `Reverse(...)` is descending score, then ascending id.
        ListResult {
            items: heap
                .into_sorted_vec()
                .into_iter()
                .map(|Reverse((_, Reverse(node)))| node)
                .collect(),
            truncated: matched > limit,
        }
    }

    /// A folder without live children (and not unreadable), or a file of length 0.
    fn is_empty_item(&self, id: u32, node: &Node) -> bool {
        if node.is_dir() {
            !node.has(flags::ACCESS_ERROR | flags::PENDING) && self.children(id).next().is_none()
        } else {
            node.len == 0
        }
    }

    /// Calls `f` for every live node below `id` in tree order (a folder before what is inside
    /// it, siblings by name), without recursion. With `count_chars`, the third argument is the
    /// length in characters of the node's path relative to `id`, else 0.
    fn walk_below(&self, id: u32, count_chars: bool, mut f: impl FnMut(u32, &Node, usize)) {
        let mut stack = vec![(id, 0usize)];
        while let Some((at, chars)) = stack.pop() {
            let node = &self.nodes[at as usize];
            if at != id {
                f(at, node, chars);
            }
            if !node.is_dir() {
                continue;
            }
            // Pushed last to first, so that the first child comes off the stack first.
            for child in (node.first_child..node.first_child + node.child_count).rev() {
                let n = &self.nodes[child as usize];
                if n.is_alive() {
                    let name = if count_chars {
                        1 + n.name.chars().count()
                    } else {
                        0
                    };
                    stack.push((child, chars + name));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
