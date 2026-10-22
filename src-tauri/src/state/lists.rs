//! Flat lists of the contents table (see `sizeatlas_core::tree::ListKind`).

use sizeatlas_core::tree::ListKind;

use super::AppState;
use super::growth;
use crate::dto::{ListDto, ListItemDto};
use crate::error::CmdError;

/// The most items a list returns, so a bogus limit cannot ask for the whole tree.
const MAX_LIST: u32 = 1_000;

impl AppState {
    /// Up to `limit` items of `kind` below `id`, each with its folder relative to `id`.
    pub fn list(
        &self,
        generation: u64,
        id: u32,
        kind: ListKind,
        limit: u32,
    ) -> Result<ListDto, CmdError> {
        let (baseline, baseline_rev) = self.compared(generation);
        self.with_live(generation, id, |tree| {
            let (baseline, limit) = (baseline.as_deref(), limit.min(MAX_LIST) as usize);
            let (items, truncated) = match (kind, baseline) {
                (ListKind::GrewMost, Some(b)) => growth::grew_most(tree, b, id, limit),
                (ListKind::GrewMost, None) => (Vec::new(), false),
                _ => {
                    let found = tree.list(id, kind, limit);
                    let items = found.items.into_iter();
                    let live = items.map(|node| ListItemDto::live(tree, id, node, baseline));
                    (live.collect(), found.truncated)
                }
            };
            ListDto {
                generation,
                rev: tree.rev,
                size: tree.node(id).size,
                truncated,
                items,
                baseline_at: baseline.map(|b| b.scanned_at),
                baseline_rev,
            }
        })
    }
}

#[cfg(test)]
mod tests;
