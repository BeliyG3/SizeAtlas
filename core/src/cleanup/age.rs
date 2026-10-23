//! Age of an item: from the newest modification time inside it to the time of the scan.

use crate::tree::Tree;

const DAY_NS: i64 = 86_400 * 1_000_000_000;

/// The newest modification time (ns) of `id` and every live node below it; `None` when any of
/// them is unknown (0), so an item with an unknown time is never old.
pub fn newest_mtime(tree: &Tree, id: u32) -> Option<i64> {
    let mut newest = i64::MIN;
    let mut stack = vec![id];
    while let Some(at) = stack.pop() {
        let mtime = tree.node(at).mtime;
        if mtime == 0 {
            return None;
        }
        newest = newest.max(mtime);
        stack.extend(tree.children(at));
    }
    Some(newest)
}

/// Whether nothing in `id` changed in the `days` before the scan.
pub fn is_old(tree: &Tree, id: u32, days: u32) -> bool {
    let scanned_ns = tree.scanned_at.saturating_mul(1_000_000_000);
    newest_mtime(tree, id)
        .is_some_and(|newest| scanned_ns.saturating_sub(newest) > i64::from(days) * DAY_NS)
}
