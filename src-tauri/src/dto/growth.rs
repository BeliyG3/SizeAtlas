//! The change of an item since the baseline (the previous full scan of its root).

use serde::Serialize;
use sizeatlas_core::baseline::{Baseline, NEW, mark};
use sizeatlas_core::tree::Tree;

/// Change of an item's size on disk since the baseline.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeDto {
    /// Bytes gained; negative when lost.
    Delta(i64),
    /// The baseline did not have the item.
    New,
    /// The folder, or one above it, was unreadable in one of the two scans.
    Unknown,
}

/// What the baseline says about one node.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Compared {
    /// Size on disk in the baseline; `None` without a baseline and for new items.
    pub before: Option<u64>,
    /// `None` without a baseline, or for an id the baseline does not have yet (added by a
    /// refresh before the baseline is computed again).
    pub change: Option<ChangeDto>,
    /// The delta is approximate: something below was unreadable in one scan, or a scan was
    /// approximate.
    pub approx: bool,
}

impl Compared {
    pub fn of(tree: &Tree, baseline: Option<&Baseline>, id: u32) -> Compared {
        let at = id as usize;
        let Some((&before, b)) = baseline.and_then(|b| Some((b.before.get(at)?, b))) else {
            return Compared::default();
        };
        let marks = b.marks.get(at).copied().unwrap_or(0);
        let before = (before != NEW).then_some(before);
        let change = match before {
            _ if marks & mark::COVERAGE != 0 => ChangeDto::Unknown,
            Some(before) => ChangeDto::Delta(delta(tree.node(id).size, before)),
            None => ChangeDto::New,
        };
        Compared {
            before,
            change: Some(change),
            approx: matches!(change, ChangeDto::Delta(_))
                && (marks & mark::APPROX != 0 || tree.approximate),
        }
    }

    /// The change a listing sorts by: a new item counts its whole `size`; `None` when unknown.
    pub fn rank(&self, size: u64) -> Option<i64> {
        match self.change? {
            ChangeDto::Delta(d) => Some(d),
            ChangeDto::New => Some(delta(size, 0)),
            ChangeDto::Unknown => None,
        }
    }
}

/// `now - before`, saturated to `i64`.
pub fn delta(now: u64, before: u64) -> i64 {
    let d = i128::from(now) - i128::from(before);
    d.clamp(i64::MIN.into(), i64::MAX.into()) as i64
}
