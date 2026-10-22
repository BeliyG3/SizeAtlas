//! Flat lists of the contents table (see `sizeatlas_core::tree::ListKind`).

use sizeatlas_core::tree::{ListKind, Query};

use super::AppState;
use super::growth;
use crate::dto::{FoundDto, ListDto, ListItemDto};
use crate::error::CmdError;

/// The most items a list returns, so a bogus limit cannot ask for the whole tree.
const MAX_LIST: u32 = 1_000;

impl AppState {
    /// Up to `limit` items of `kind` below `id`, each with its folder relative to `id`. `query`
    /// is the text of a [`ListKind::Search`] and ignored by the other kinds.
    pub fn list(
        &self,
        generation: u64,
        id: u32,
        kind: ListKind,
        limit: u32,
        query: Option<&str>,
    ) -> Result<ListDto, CmdError> {
        let (baseline, baseline_rev, baseline_pending) = self.compared(generation);
        self.with_live(generation, id, |tree| {
            let (baseline, limit) = (baseline.as_deref(), limit.min(MAX_LIST) as usize);
            let live = |nodes: Vec<u32>| -> Vec<ListItemDto> {
                let items = nodes.into_iter();
                items
                    .map(|node| ListItemDto::live(tree, id, node, baseline))
                    .collect()
            };
            let mut totals = None;
            let (items, truncated) = match (kind, baseline) {
                (ListKind::GrewMost, Some(b)) => growth::grew_most(tree, b, id, limit),
                (ListKind::GrewMost, None) => (Vec::new(), false),
                (ListKind::Search, _) => match query.and_then(Query::parse) {
                    Some(query) => {
                        let found = tree.search(id, &query, limit);
                        totals = Some(FoundDto {
                            count: found.count,
                            size: found.size,
                        });
                        (live(found.items), found.truncated)
                    }
                    None => {
                        totals = Some(FoundDto { count: 0, size: 0 });
                        (Vec::new(), false)
                    }
                },
                _ => {
                    let found = tree.list(id, kind, limit);
                    (live(found.items), found.truncated)
                }
            };
            ListDto {
                generation,
                rev: tree.rev,
                size: tree.node(id).size,
                truncated,
                items,
                found: totals,
                baseline_at: baseline.map(|b| b.scanned_at),
                baseline_rev,
                baseline_pending,
            }
        })
    }
}

#[cfg(test)]
mod tests;
