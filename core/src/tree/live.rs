//! Temporary totals of a root folder whose contents have not been published yet.

use super::{Tree, flags};

impl Tree {
    pub fn set_scanning(&mut self, id: u32, scanning: bool) {
        if scanning {
            self.nodes[id as usize].flags |= flags::SCANNING;
        } else {
            self.nodes[id as usize].flags &= !flags::SCANNING;
        }
        self.rev += 1;
    }

    /// Only a pending direct child can have provisional totals. No children are exposed until
    /// replace_subtree replaces these totals with the final scan and updates the root delta.
    pub fn set_scan_progress(&mut self, id: u32, size: u64, files: u32) {
        assert_eq!(self.nodes[id as usize].parent, 0);
        assert!(self.nodes[id as usize].has(flags::PENDING));
        let node = &mut self.nodes[id as usize];
        let (old_size, old_files) = (node.size, node.files);
        node.size = size;
        node.files = files;
        let root = &mut self.nodes[0];
        root.size = root.size - old_size + size;
        root.files = root.files - old_files + files;
        self.rev += 1;
    }
}
