//! Read queries for the desktop app: safe lookup, paged children, breadcrumbs.

use std::cmp::Ordering;

use super::{ListOrder, NO_PARENT, Node, Tree, flags};

/// One page of a directory's live children in a requested order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChildrenPage {
    pub items: Vec<u32>,
    /// Live children in total.
    pub total: u32,
    /// Live children after this page, and their combined size.
    pub rest_count: u32,
    pub rest_size: u64,
}

impl Tree {
    /// The node, if `id` is in bounds and alive. Use this for ids that come from outside.
    pub fn get(&self, id: u32) -> Option<&Node> {
        self.nodes.get(id as usize).filter(|n| n.is_alive())
    }

    /// Live children of `id` listed with `order` (folders only if `order.dirs_only`);
    /// returns `[offset, offset + limit)` and what is left after it.
    // ponytail: sorts all children per page (about 30 ms for 300 000 entries in release);
    // switch to select_nth_unstable_by or cache the sorted ids if huge folders feel slow.
    pub fn children_page(
        &self,
        id: u32,
        offset: u32,
        limit: u32,
        order: ListOrder,
    ) -> ChildrenPage {
        self.children_page_by(id, offset, limit, order, |a, b| self.compare(a, b, order))
    }

    /// Like [`Tree::children_page`], sorted by `compare` instead of `order.key`: for a key the
    /// tree does not know, such as the change since the previous scan.
    pub fn children_page_by(
        &self,
        id: u32,
        offset: u32,
        limit: u32,
        order: ListOrder,
        compare: impl Fn(u32, u32) -> Ordering,
    ) -> ChildrenPage {
        let mut ids: Vec<u32> = self
            .children(id)
            .filter(|&c| self.listed(c, order))
            .collect();
        ids.sort_unstable_by(|&a, &b| compare(a, b));
        let start = (offset as usize).min(ids.len());
        let end = start.saturating_add(limit as usize).min(ids.len());
        let rest = &ids[end..];
        ChildrenPage {
            total: ids.len() as u32,
            rest_count: rest.len() as u32,
            rest_size: rest.iter().fold(0u64, |sum, &c| {
                sum.saturating_add(self.nodes[c as usize].size)
            }),
            items: ids[start..end].to_vec(),
        }
    }

    /// Index of `id` in its parent's listing made with `order`; `None` for the root
    /// and for a file in a folders-only listing.
    pub fn position(&self, id: u32, order: ListOrder) -> Option<u32> {
        self.position_by(id, order, |a, b| self.compare(a, b, order))
    }

    /// Like [`Tree::position`] in a listing made by [`Tree::children_page_by`].
    pub fn position_by(
        &self,
        id: u32,
        order: ListOrder,
        compare: impl Fn(u32, u32) -> Ordering,
    ) -> Option<u32> {
        let parent = self.nodes[id as usize].parent;
        (parent != NO_PARENT && self.listed(id, order))
            .then(|| self.count_before(parent, id, order, compare))
    }

    /// Position of `id` among its sibling folders in tree order ([`ListOrder::FOLDERS`]:
    /// by name); for a file, the number of sibling folders listed before it; 0 for the root.
    pub fn rank(&self, id: u32) -> u32 {
        self.rank_in(id, ListOrder::FOLDERS)
    }

    /// Like [`Tree::rank`] for a listing made with `order`: the number of siblings listed
    /// before `id`, which is its index in its parent's pages; 0 for the root.
    pub fn rank_in(&self, id: u32, order: ListOrder) -> u32 {
        let parent = self.nodes[id as usize].parent;
        if parent == NO_PARENT {
            return 0;
        }
        self.count_before(parent, id, order, |a, b| self.compare(a, b, order))
    }

    /// Number of live folders directly inside `id`.
    pub fn direct_dirs(&self, id: u32) -> u32 {
        self.children(id)
            .filter(|&c| self.nodes[c as usize].is_dir())
            .count() as u32
    }

    /// Live children of `parent` that a listing made with `order`, sorted by `compare`, puts
    /// before `id`.
    fn count_before(
        &self,
        parent: u32,
        id: u32,
        order: ListOrder,
        compare: impl Fn(u32, u32) -> Ordering,
    ) -> u32 {
        self.children(parent)
            .filter(|&c| self.listed(c, order) && compare(c, id).is_lt())
            .count() as u32
    }

    /// Used space of the volume that the scan did not find (system files, unreadable folders,
    /// the recycle bin…). `None` when the scan root is not the root of a volume.
    pub fn unaccounted(&self) -> Option<u64> {
        self.volume
            .map(|v| v.used.saturating_sub(self.nodes[0].size))
    }

    /// Ids from the root down to `id`, inclusive.
    pub fn crumbs(&self, id: u32) -> Vec<u32> {
        let mut chain = Vec::new();
        let mut cur = id;
        while cur != NO_PARENT {
            chain.push(cur);
            cur = self.nodes[cur as usize].parent;
        }
        chain.reverse();
        chain
    }

    /// Whether `id` or one of its ancestors has a name that was not valid Unicode,
    /// so `path(id)` would not point at the real file.
    pub fn has_lossy_path(&self, id: u32) -> bool {
        self.crumbs(id)
            .iter()
            .any(|&c| self.nodes[c as usize].has(flags::LOSSY_NAME))
    }
}

#[cfg(test)]
mod tests;
