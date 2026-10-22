//! Flat lists of the contents table (see `sizeatlas_core::tree::ListKind`).

use sizeatlas_core::tree::{ListKind, Query};

use super::AppState;
use super::growth;
use crate::dto::{FoundDto, ListDto, ListItemDto};
use crate::error::CmdError;

/// The most items a list returns, so a bogus limit cannot ask for the whole tree.
const MAX_LIST: u32 = 1_000;

/// The most characters of a search query that are used: the text comes from the UI, and a huge
/// mask would make every node cost that much.
const MAX_QUERY: usize = 256;

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
            let (items, truncated, found) = match (kind, baseline) {
                (ListKind::GrewMost, Some(b)) => {
                    let (items, truncated) = growth::grew_most(tree, b, id, limit);
                    (items, truncated, None)
                }
                (ListKind::GrewMost, None) => (Vec::new(), false, None),
                (ListKind::Search, _) => {
                    let query: Option<String> = query.map(|q| q.chars().take(MAX_QUERY).collect());
                    match query.as_deref().and_then(Query::parse) {
                        Some(query) => {
                            let found = tree.search(id, &query, limit);
                            let totals = FoundDto {
                                count: found.count,
                                size: found.size,
                            };
                            (live(found.items), found.truncated, Some(totals))
                        }
                        None => (Vec::new(), false, Some(FoundDto { count: 0, size: 0 })),
                    }
                }
                _ => {
                    let found = tree.list(id, kind, limit);
                    (live(found.items), found.truncated, None)
                }
            };
            ListDto {
                generation,
                rev: tree.rev,
                size: tree.node(id).size,
                truncated,
                items,
                found,
                baseline_at: baseline.map(|b| b.scanned_at),
                baseline_rev,
                baseline_pending,
            }
        })
    }
}

#[cfg(test)]
mod tests;
