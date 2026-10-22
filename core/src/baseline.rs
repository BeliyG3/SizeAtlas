//! Comparison of the current tree with the tree of the previous full scan.

use std::cmp::Ordering;

use crate::tree::{NO_PARENT, Tree, flags};

/// `before` value of a node that the previous scan did not have.
pub const NEW: u64 = u64::MAX;

/// Bits of [`Baseline::marks`].
pub mod mark {
    /// The node's `ACCESS_ERROR` differs between the two scans: its change is unknown.
    pub const COVERAGE: u8 = 1;
    /// The change is approximate: a descendant has `COVERAGE`, or either tree is approximate.
    pub const APPROX: u8 = 2;
}

/// A child of a current folder that the previous scan had and the current one lacks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Deleted {
    /// Current id of the folder that held it.
    pub parent: u32,
    pub name: Box<str>,
    pub size: u64,
}

/// What the previous scan knew, indexed by current node id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Baseline {
    pub scanned_at: i64,
    /// Previous on-disk size of each current node, [`NEW`] when absent; dead nodes: any value.
    pub before: Vec<u64>,
    pub marks: Vec<u8>,
    /// Topmost deleted items only; their descendants are not listed.
    pub deleted: Vec<Deleted>,
}

/// Whether `base` can serve as the baseline of `current`: same root path and size measure.
pub fn compatible(current: &Tree, base: &Tree) -> bool {
    current.name(0) == base.name(0)
        && current.size_mode == base.size_mode
        && current.cluster == base.cluster
}

/// Matches both trees by path. Assumes [`compatible`] (the roots are matched).
pub fn compare(current: &Tree, base: &Tree) -> Baseline {
    let mut before = vec![NEW; current.len()];
    let mut marks = vec![0u8; current.len()];
    let mut deleted = Vec::new();
    // Matched nodes whose ACCESS_ERROR differs between the scans.
    let mut uncovered = Vec::new();
    let mut matched = |c: u32, b: u32| {
        before[c as usize] = base.node(b).size;
        if current.node(c).has(flags::ACCESS_ERROR) != base.node(b).has(flags::ACCESS_ERROR) {
            uncovered.push(c);
        }
    };

    matched(0, 0);
    // Pairs of matched folders; children are merge-joined (both blocks are sorted by name bytes).
    let mut stack = vec![(0u32, 0u32)];
    while let Some((cur_dir, base_dir)) = stack.pop() {
        // An unreadable folder lists nothing now: its old contents are unknown, not deleted.
        let readable = !current.node(cur_dir).has(flags::ACCESS_ERROR);
        let mut cur = current.children(cur_dir).peekable();
        let mut old = base.children(base_dir).peekable();
        loop {
            let order = match (cur.peek(), old.peek()) {
                (None, None) => break,
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                (Some(&c), Some(&b)) => current.name(c).as_bytes().cmp(base.name(b).as_bytes()),
            };
            match order {
                // New: `before` stays NEW, and so does everything below it.
                Ordering::Less => {
                    cur.next();
                }
                // Deleted files only shrink the parent's `before`; folders are listed.
                Ordering::Greater => {
                    let b = old.next().expect("peeked");
                    if readable && base.node(b).is_dir() {
                        deleted.push(Deleted {
                            parent: cur_dir,
                            name: base.name(b).into(),
                            size: base.node(b).size,
                        });
                    }
                }
                Ordering::Equal => {
                    let (c, b) = (cur.next().expect("peeked"), old.next().expect("peeked"));
                    matched(c, b);
                    if current.node(c).is_dir() && base.node(b).is_dir() {
                        stack.push((c, b));
                    }
                }
            }
        }
    }

    if current.approximate || base.approximate {
        marks.iter_mut().for_each(|m| *m |= mark::APPROX);
    } else {
        mark_ancestors(current, &mut marks, &uncovered);
    }
    mark_subtrees(current, &mut marks, &uncovered);

    Baseline {
        scanned_at: base.scanned_at,
        before,
        marks,
        deleted,
    }
}

/// APPROX on every ancestor of `uncovered` nodes.
fn mark_ancestors(current: &Tree, marks: &mut [u8], uncovered: &[u32]) {
    for &id in uncovered {
        // Stops at the first ancestor already marked: everything above it is marked too.
        let mut p = current.node(id).parent;
        while p != NO_PARENT && marks[p as usize] & mark::APPROX == 0 {
            marks[p as usize] |= mark::APPROX;
            p = current.node(p).parent;
        }
    }
}

/// COVERAGE on `uncovered` nodes and all their live descendants: what lies below a folder
/// that was unreadable in one scan is unknown, not new.
fn mark_subtrees(current: &Tree, marks: &mut [u8], uncovered: &[u32]) {
    for &id in uncovered {
        marks[id as usize] |= mark::COVERAGE;
    }
    for &id in uncovered {
        let mut stack = vec![id];
        while let Some(dir) = stack.pop() {
            for c in current.children(dir) {
                // Already marked: an `uncovered` node (walked on its own) or a walked subtree.
                if marks[c as usize] & mark::COVERAGE == 0 {
                    marks[c as usize] |= mark::COVERAGE;
                    stack.push(c);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
