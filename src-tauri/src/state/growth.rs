//! Reads that need the baseline: a folder's listing, which may sort by change, and the "grew
//! most" list.

use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashSet};
use std::sync::Arc;

use sizeatlas_core::baseline::{Baseline, NEW, mark};
use sizeatlas_core::tree::{ListOrder, SortKey, Tree};

use super::AppState;
use crate::dto::{ChildrenDto, Compared, ItemDto, ListItemDto, delta};
use crate::error::CmdError;

impl AppState {
    /// The baseline of the root with `generation`, its `baseline_rev` and whether it is being
    /// computed, read together.
    pub(super) fn compared(&self, generation: u64) -> (Option<Arc<Baseline>>, u64, bool) {
        self.read_data()
            .roots
            .iter()
            .find(|r| r.generation == generation)
            .map(|r| (r.baseline.clone(), r.baseline_rev, r.baseline_pending))
            .unwrap_or_default()
    }

    pub fn children(
        &self,
        generation: u64,
        id: u32,
        offset: u32,
        limit: u32,
        order: ListOrder,
    ) -> Result<ChildrenDto, CmdError> {
        let (baseline, baseline_rev, baseline_pending) = self.compared(generation);
        self.with_live(generation, id, |tree| {
            let baseline = baseline.as_deref();
            let page = match order.key {
                SortKey::Change => {
                    let compare = by_change(tree, baseline, order.descending);
                    tree.children_page_by(id, offset, limit, order, compare)
                }
                _ => tree.children_page(id, offset, limit, order),
            };
            ChildrenDto {
                generation,
                rev: tree.rev,
                approximate: tree.approximate,
                size: tree.node(id).size,
                total: page.total,
                rest_count: page.rest_count,
                rest_size: page.rest_size,
                items: page
                    .items
                    .iter()
                    .map(|&c| ItemDto::of(tree, c, baseline))
                    .collect(),
                baseline_at: baseline.map(|b| b.scanned_at),
                baseline_rev,
                baseline_pending,
            }
        })
    }

    /// Index of `id` in its parent's listing made with `order`; `None` for the root and for
    /// files in a folders-only listing.
    pub fn position(
        &self,
        generation: u64,
        id: u32,
        order: ListOrder,
    ) -> Result<Option<u32>, CmdError> {
        let baseline = self.baseline(generation);
        self.with_live(generation, id, |tree| match order.key {
            SortKey::Change => {
                let compare = by_change(tree, baseline.as_deref(), order.descending);
                tree.position_by(id, order, compare)
            }
            _ => tree.position(id, order),
        })
    }
}

/// By change (a new item counts its size), unknown ones last in both directions; ties by name
/// bytes, then by id, as the tree's own orders.
fn by_change<'a>(
    tree: &'a Tree,
    baseline: Option<&'a Baseline>,
    descending: bool,
) -> impl Fn(u32, u32) -> Ordering + 'a {
    move |a, b| {
        let rank = |id| Compared::of(tree, baseline, id).rank(tree.node(id).size);
        let primary = match (rank(a), rank(b)) {
            (Some(x), Some(y)) if descending => y.cmp(&x),
            (Some(x), Some(y)) => x.cmp(&y),
            (x, y) => x.is_none().cmp(&y.is_none()),
        };
        primary
            .then_with(|| tree.name(a).as_bytes().cmp(tree.name(b).as_bytes()))
            .then(a.cmp(&b))
    }
}

/// A row of the "grew most" list; ordered so that ties keep a stable order.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Row {
    Live(u32),
    /// Index into the deleted folders.
    Gone(usize),
}

/// A deleted folder: its parent in the tree, its name and its size in the baseline, and
/// whether that size is approximate.
type Gone<'a> = ((u32, &'a str, u64), bool);

/// Up to `limit` folders below `base` with the largest absolute change, live ones and deleted
/// ones, sorted by change, largest growth first; and whether more matched.
pub(super) fn grew_most(
    tree: &Tree,
    baseline: &Baseline,
    base: u32,
    limit: usize,
) -> (Vec<ListItemDto>, bool) {
    let gone = deleted_below(tree, baseline, base);
    let mut matched = 0usize;
    // Min-heap of the best rows so far, as `Tree::list` keeps them.
    let mut heap = BinaryHeap::with_capacity(limit.min(1024));
    let mut offer = |change: i64, row: Row| {
        matched += 1;
        let entry = Reverse((change.unsigned_abs(), Reverse(row), change));
        if heap.len() < limit {
            heap.push(entry);
        } else if let Some(mut worst) = heap.peek_mut()
            && entry < *worst
        {
            *worst = entry;
        }
    };
    let mut stack = vec![base];
    while let Some(dir) = stack.pop() {
        for c in tree.children(dir).filter(|&c| tree.node(c).is_dir()) {
            stack.push(c);
            let change = Compared::of(tree, Some(baseline), c).rank(tree.node(c).size);
            if let Some(change) = change.filter(|&d| d != 0) {
                offer(change, Row::Live(c));
            }
        }
    }
    for (i, &((_, _, size), _)) in gone.iter().enumerate() {
        offer(delta(0, size), Row::Gone(i));
    }
    let mut rows: Vec<(i64, Row)> = heap
        .into_iter()
        .map(|Reverse((_, Reverse(row), change))| (change, row))
        .collect();
    rows.sort_unstable_by_key(|&(change, row)| (Reverse(change), row));
    let items = rows
        .into_iter()
        .enumerate()
        .map(|(i, (_, row))| match row {
            Row::Live(id) => ListItemDto::live(tree, base, id, Some(baseline)),
            Row::Gone(at) => {
                let (folder, approx) = gone[at];
                ListItemDto::deleted(tree, base, u32::MAX - i as u32, folder, approx)
            }
        })
        .collect();
    (items, matched > limit)
}

/// The topmost deleted folders in `base` or below it: those of the baseline, and the folders
/// that died since it was computed (a trash, a refresh) and that it had.
fn deleted_below<'a>(tree: &'a Tree, baseline: &'a Baseline, base: u32) -> Vec<Gone<'a>> {
    let approx = |id: u32| {
        tree.approximate
            || baseline.marks.get(id as usize).copied().unwrap_or(0) & mark::APPROX != 0
    };
    // A parent that died since is itself one of the dead folders below, or inside one.
    let holds = |parent: u32| tree.get(parent).is_some() && tree.crumbs(parent).contains(&base);
    let mut gone: Vec<Gone> = baseline
        .deleted
        .iter()
        .filter(|d| holds(d.parent))
        .map(|d| ((d.parent, &*d.name, d.size), approx(d.parent)))
        .collect();
    let listed: HashSet<(u32, &str)> = gone.iter().map(|&((p, name, _), _)| (p, name)).collect();
    // ponytail: walks every node of the tree, not only those below `base`; keep a list of the
    // dead folders in the tree if lists of small folders in huge trees feel slow.
    for (id, &before) in (0u32..).zip(&baseline.before).take(tree.len()) {
        let node = tree.node(id);
        let topmost = !node.is_alive() && node.is_dir() && tree.get(node.parent).is_some();
        if topmost && before != NEW && holds(node.parent) {
            let name = tree.name(id);
            if !listed.contains(&(node.parent, name)) {
                gone.push(((node.parent, name, before), approx(id)));
            }
        }
    }
    // The list is about paths: a folder that a refresh found again (a new id, beyond the old
    // baseline until it is computed again) or that was created again is not deleted.
    let parents: HashSet<u32> = gone.iter().map(|&((p, _, _), _)| p).collect();
    let alive: HashSet<(u32, &str)> = parents
        .into_iter()
        .flat_map(|p| tree.children(p).map(move |c| (p, tree.name(c))))
        .collect();
    gone.retain(|&((p, name, _), _)| !alive.contains(&(p, name)));
    gone
}

#[cfg(test)]
mod tests;
