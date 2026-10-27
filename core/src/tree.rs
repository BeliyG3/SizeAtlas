//! Flat, append-only tree of scanned files and directories.
//!
//! Nodes live in one `Vec`; a node id is its index. The root is node 0 and its
//! name is the full canonical path. Children of every directory occupy one
//! contiguous block `first_child..first_child + child_count`.

use std::ffi::OsString;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Parent id of the root node.
pub const NO_PARENT: u32 = u32::MAX;

/// Bit flags stored in [`Node::flags`] and in scan records.
pub mod flags {
    pub const IS_DIR: u8 = 1 << 0;
    pub const ALIVE: u8 = 1 << 1;
    pub const ACCESS_ERROR: u8 = 1 << 2;
    pub const LOSSY_NAME: u8 = 1 << 3;
    pub const CLOUD: u8 = 1 << 4;
    pub const HARDLINK: u8 = 1 << 5;
    /// Live scan only; never saved to the cache.
    pub const PENDING: u8 = 1 << 6;
    pub const SCANNING: u8 = 1 << 7;
}

/// A file found by a scanner, before it is placed in the tree.
#[derive(Clone, Debug)]
pub struct FileRec {
    pub name: OsString,
    /// Size on disk as computed by the scanner.
    pub size: u64,
    /// Logical length in bytes (cloud-only placeholders keep their length, their `size` is 0).
    pub len: u64,
    pub mtime: i64,
    pub flags: u8,
    /// `(device, inode)` for files with several hard links (Unix only).
    pub ino: Option<(u64, u64)>,
}

/// One directory found by a scanner. Scan-local ids are dense from 0;
/// the scan root has id 0, parent [`NO_PARENT`] and its full path as name.
#[derive(Clone, Debug)]
pub struct DirRec {
    pub id: u32,
    pub parent: u32,
    pub name: OsString,
    pub mtime: i64,
    pub flags: u8,
    pub files: Vec<FileRec>,
}

/// How [`Node::size`] was measured.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SizeMode {
    /// Blocks allocated on disk (Unix).
    Allocated,
    /// File length rounded up to the volume cluster size (Windows).
    ClusterEstimate,
    /// Plain file length (cluster size unknown).
    Logical,
}

/// Facts about a scan that are not per-node.
#[derive(Clone, Copy, Debug)]
pub struct ScanMeta {
    pub cluster: u64,
    pub size_mode: SizeMode,
    pub scanned_at: i64,
}

/// Space of the volume a scan covered, measured when the scan finished.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VolumeUsage {
    pub total: u64,
    pub used: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Node {
    name: Box<str>,
    pub parent: u32,
    pub first_child: u32,
    pub child_count: u32,
    /// Total size on disk; for directories, of the whole subtree.
    pub size: u64,
    /// Number of files; for directories, of the whole subtree.
    pub files: u32,
    /// Logical length; for directories, of the whole subtree.
    pub len: u64,
    /// Number of directories below this one, at any depth; 0 for files.
    pub dirs: u32,
    pub mtime: i64,
    pub category: u8,
    pub flags: u8,
}

impl Node {
    pub fn is_dir(&self) -> bool {
        self.has(flags::IS_DIR)
    }

    pub fn is_alive(&self) -> bool {
        self.has(flags::ALIVE)
    }

    pub fn has(&self, flag: u8) -> bool {
        self.flags & flag != 0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tree {
    nodes: Vec<Node>,
    pub live: u32,
    pub dead: u32,
    pub rev: u64,
    pub cluster: u64,
    pub size_mode: SizeMode,
    pub approximate: bool,
    pub access_errors: u32,
    pub scanned_at: i64,
    /// Set when the scan root is the root of a volume.
    pub volume: Option<VolumeUsage>,
}

impl Tree {
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    pub fn node(&self, id: u32) -> &Node {
        &self.nodes[id as usize]
    }

    /// Test helper for crates that use the tree (the desktop app).
    #[doc(hidden)]
    pub fn mark_lossy_for_test(&mut self, id: u32) {
        self.nodes[id as usize].flags |= flags::LOSSY_NAME;
    }

    /// Test helper for crates that use the tree (the desktop app).
    #[doc(hidden)]
    pub fn mark_cloud_for_test(&mut self, id: u32) {
        self.nodes[id as usize].flags |= flags::CLOUD;
    }

    pub fn name(&self, id: u32) -> &str {
        &self.nodes[id as usize].name
    }

    /// Live children of `id` in storage order (by name).
    pub fn children(&self, id: u32) -> impl Iterator<Item = u32> + '_ {
        let n = &self.nodes[id as usize];
        (n.first_child..n.first_child + n.child_count)
            .filter(|&c| self.nodes[c as usize].is_alive())
    }

    /// Full path of a node: the root path joined with the names below it.
    pub fn path(&self, id: u32) -> PathBuf {
        let mut parts = Vec::new();
        let mut cur = id;
        while cur != NO_PARENT {
            parts.push(self.name(cur));
            cur = self.nodes[cur as usize].parent;
        }
        parts.iter().rev().collect()
    }

    #[cfg(test)]
    pub(crate) fn nodes_mut_for_test(&mut self) -> &mut Vec<Node> {
        &mut self.nodes
    }

    #[cfg(test)]
    pub(crate) fn assert_invariants(&self) {
        self.check_structure().unwrap();
        for id in 0..self.len() as u32 {
            let n = self.node(id);
            if n.is_alive() && n.is_dir() {
                for c in self.children(id) {
                    assert_eq!(self.node(c).parent, id, "child block of {}", self.name(id));
                }
                let (size, files, len, dirs) =
                    self.children(id).fold((0, 0, 0, 0), |(s, f, l, d), c| {
                        let n = self.node(c);
                        (
                            s + n.size,
                            f + n.files,
                            l + n.len,
                            d + n.dirs + u32::from(n.is_dir()),
                        )
                    });
                assert_eq!(
                    (n.size, n.files, n.len, n.dirs),
                    (size, files, len, dirs),
                    "totals of {}",
                    self.name(id)
                );
            }
        }
    }
}

/// Small tree used by tests of other modules.
#[cfg(test)]
pub(crate) fn sample_tree() -> Tree {
    let file = |name: &str, size| FileRec {
        name: name.into(),
        size,
        len: size,
        mtime: 7,
        flags: 0,
        ino: None,
    };
    let dir = |id, parent, name: &str, files| DirRec {
        id,
        parent,
        name: name.into(),
        mtime: 3,
        flags: 0,
        files,
    };
    Tree::from_records(
        vec![
            dir(0, NO_PARENT, "/root", vec![file("a.mp4", 500)]),
            dir(1, 0, "docs", vec![file("b.pdf", 30), file("c.txt", 2)]),
            dir(2, 1, "deep", vec![file("d.png", 40)]),
        ],
        ScanMeta {
            cluster: 4096,
            size_mode: SizeMode::ClusterEstimate,
            scanned_at: 1_700_000_000,
        },
    )
}

mod build;
mod edit;
mod graft;
mod lists;
mod live;
mod order;
mod query;
mod search;
mod stats;
mod validate;

pub use lists::{ListKind, ListResult};
pub use order::{ListOrder, SortKey};
pub use query::ChildrenPage;
pub(crate) use search::glob;
pub use search::{Filters, Found, Kind, Query};
pub use stats::TypeStat;

#[cfg(test)]
mod tests;
