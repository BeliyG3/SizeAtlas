//! Building the flat tree from scan records.

use std::collections::{HashSet, VecDeque};
use std::ffi::OsStr;

use super::{DirRec, FileRec, NO_PARENT, Node, ScanMeta, Tree, flags};
use crate::categories::{DIR_CATEGORY, categorize};

enum Entry {
    Dir(u32),
    File(FileRec),
}

impl Tree {
    /// Builds a tree from the records of one full scan.
    ///
    /// # Panics
    /// If `records` has no root record (id 0) — scanners always produce it.
    pub fn from_records(records: Vec<DirRec>, meta: ScanMeta) -> Tree {
        Self::from_records_with_links(records, meta, &mut HashSet::new())
    }

    /// Uses a scan-wide set; name-sorted breadth-first traversal chooses the counted link.
    pub fn from_records_with_links(
        records: Vec<DirRec>,
        meta: ScanMeta,
        seen_links: &mut HashSet<(u64, u64)>,
    ) -> Tree {
        let root = records
            .iter()
            .find(|r| r.id == 0)
            .expect("scan records contain the root (id 0)");
        let (name, lossy) = node_name(&root.name);
        let root_node = Node {
            name,
            parent: NO_PARENT,
            first_child: 1,
            child_count: 0,
            size: 0,
            files: 0,
            len: 0,
            dirs: 0,
            mtime: 0,
            category: DIR_CATEGORY,
            flags: flags::IS_DIR | flags::ALIVE | lossy,
        };
        let mut tree = Tree {
            nodes: vec![root_node],
            live: 1,
            dead: 0,
            rev: 0,
            cluster: meta.cluster,
            size_mode: meta.size_mode,
            approximate: false,
            access_errors: 0,
            scanned_at: meta.scanned_at,
            volume: None,
        };
        tree.flatten(records, 0, seen_links);
        tree
    }

    /// Lays out every record below scan-root record 0 as descendants of the existing
    /// node `root_id`, breadth-first so that each directory's children form one block,
    /// then recomputes totals of the new nodes and of `root_id` from scratch.
    fn flatten(
        &mut self,
        records: Vec<DirRec>,
        root_id: u32,
        seen_links: &mut HashSet<(u64, u64)>,
    ) {
        let slots_len = records.iter().map(|r| r.id as usize + 1).max().unwrap_or(0);
        let mut slots: Vec<Option<DirRec>> = (0..slots_len).map(|_| None).collect();
        let mut subdirs: Vec<Vec<u32>> = vec![Vec::new(); slots_len];
        for rec in records {
            if rec.parent != NO_PARENT {
                subdirs[rec.parent as usize].push(rec.id);
            }
            if rec.flags & flags::ACCESS_ERROR != 0 {
                self.access_errors += 1;
            }
            let id = rec.id as usize;
            slots[id] = Some(rec);
        }

        let base = self.nodes.len();
        let mut queue = VecDeque::from([(0u32, root_id)]);
        while let Some((scan_id, node_id)) = queue.pop_front() {
            let rec = slots[scan_id as usize]
                .take()
                .expect("each directory record is visited once");
            let mut entries: Vec<Entry> = subdirs[scan_id as usize]
                .iter()
                .map(|&d| Entry::Dir(d))
                .collect();
            entries.extend(rec.files.into_iter().map(Entry::File));
            let entry_name = |e: &Entry| match e {
                Entry::Dir(d) => slots[*d as usize]
                    .as_ref()
                    .expect("subdirectory record")
                    .name
                    .clone(),
                Entry::File(f) => f.name.clone(),
            };
            entries.sort_by_cached_key(|e| entry_name(e).into_encoded_bytes());

            let first_child = self.nodes.len() as u32;
            {
                let node = &mut self.nodes[node_id as usize];
                node.mtime = rec.mtime;
                node.flags =
                    (node.flags & flags::LOSSY_NAME) | flags::ALIVE | flags::IS_DIR | rec.flags;
                node.size = 0;
                node.files = 0;
                node.len = 0;
                node.dirs = 0;
                node.first_child = first_child;
                node.child_count = entries.len() as u32;
            }
            for entry in entries {
                let new_id = self.nodes.len() as u32;
                match entry {
                    Entry::Dir(d) => {
                        let (name, lossy) = node_name(
                            &slots[d as usize]
                                .as_ref()
                                .expect("subdirectory record")
                                .name,
                        );
                        self.nodes.push(Node {
                            name,
                            parent: node_id,
                            first_child: 0,
                            child_count: 0,
                            size: 0,
                            files: 0,
                            len: 0,
                            dirs: 0,
                            mtime: 0,
                            category: DIR_CATEGORY,
                            flags: flags::IS_DIR | flags::ALIVE | lossy,
                        });
                        queue.push_back((d, new_id));
                    }
                    Entry::File(file) => {
                        let (name, lossy) = node_name(&file.name);
                        let mut node_flags = flags::ALIVE | file.flags | lossy;
                        let mut size = file.size;
                        if let Some(key) = file.ino {
                            node_flags |= flags::HARDLINK;
                            if !seen_links.insert(key) {
                                size = 0;
                            }
                        }
                        let category = categorize(&name) as u8;
                        self.nodes.push(Node {
                            name,
                            parent: node_id,
                            first_child: 0,
                            child_count: 0,
                            size,
                            files: 1,
                            len: file.len,
                            dirs: 0,
                            mtime: file.mtime,
                            category,
                            flags: node_flags,
                        });
                    }
                }
            }
        }

        // Children always come after their parent, so one reverse pass sums every subtree.
        for i in (base..self.nodes.len()).rev() {
            let (size, files, len, dirs, parent) = {
                let n = &self.nodes[i];
                (
                    n.size,
                    n.files,
                    n.len,
                    n.dirs + u32::from(n.is_dir()),
                    n.parent,
                )
            };
            let p = &mut self.nodes[parent as usize];
            p.size += size;
            p.files += files;
            p.len += len;
            p.dirs += dirs;
        }
        self.live += (self.nodes.len() - base) as u32;
    }
}

fn node_name(name: &OsStr) -> (Box<str>, u8) {
    match name.to_str() {
        Some(s) => (s.into(), 0),
        None => (name.to_string_lossy().into(), flags::LOSSY_NAME),
    }
}
