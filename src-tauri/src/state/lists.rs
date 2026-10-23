//! Flat lists of the contents table (see `sizeatlas_core::tree::ListKind`).

use std::cmp::Reverse;

use sizeatlas_core::baseline::Baseline;
use sizeatlas_core::cleanup::{Cleanup, Info, Mode, Row};
use sizeatlas_core::tree::{ListKind, Query, Tree};

use super::AppState;
use super::growth;
use crate::dto::{CleanupDto, FoundDto, InfoDto, ListDto, ListItemDto, ReasonDto};
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
        let walked = match kind {
            ListKind::Cleanup | ListKind::Review => Some(self.walked(generation)?),
            _ => None,
        };
        self.with_live(generation, id, |tree| {
            let (baseline, limit) = (baseline.as_deref(), limit.min(MAX_LIST) as usize);
            let live = |nodes: Vec<u32>| -> Vec<ListItemDto> {
                let items = nodes.into_iter();
                items
                    .map(|node| ListItemDto::live(tree, id, node, baseline))
                    .collect()
            };
            let (mut cleanup, mut rev) = (None, tree.rev);
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
                (ListKind::Cleanup | ListKind::Review, _) => {
                    let mode = match kind {
                        ListKind::Cleanup => Mode::Cleanup,
                        _ => Mode::Review,
                    };
                    let (walked_rev, all) = walked.clone().expect("walked for these kinds");
                    // The rev the rows were found at: if the tree changed after the walk, it
                    // tells the UI to ask again, which walks again.
                    rev = walked_rev;
                    let (items, truncated, found, info) =
                        cleanup_rows(tree, id, mode, limit, &all, baseline);
                    cleanup = Some(info);
                    (items, truncated, Some(found))
                }
                _ => {
                    let found = tree.list(id, kind, limit);
                    (live(found.items), found.truncated, None)
                }
            };
            ListDto {
                generation,
                rev,
                size: tree.node(id).size,
                truncated,
                items,
                found,
                cleanup,
                baseline_at: baseline.map(|b| b.scanned_at),
                baseline_rev,
                baseline_pending,
            }
        })
    }
}

/// The rows of `mode` inside `base`, largest first, their totals and the info about the same
/// nodes. `base` itself is listed when it is a row, on purpose: the mode shows "the folder and
/// everything inside", and that row is the only way to see why the selected folder is junk.
/// Rows of nodes no longer live (the tree changed after the walk) are left out.
fn cleanup_rows(
    tree: &Tree,
    base: u32,
    mode: Mode,
    limit: usize,
    all: &Cleanup,
    baseline: Option<&Baseline>,
) -> (Vec<ListItemDto>, bool, FoundDto, CleanupDto) {
    let inside = |id: u32| tree.get(id).is_some() && tree.crumbs(id).contains(&base);
    let rows = match mode {
        Mode::Cleanup => &all.cleanup,
        Mode::Review => &all.review,
    };
    let mut kept: Vec<&Row> = rows.iter().filter(|row| inside(row.id)).collect();
    let size = |row: &Row| tree.node(row.id).size;
    kept.sort_by_key(|&row| (Reverse(size(row)), row.id));
    let found = FoundDto {
        count: kept.len() as u64,
        size: kept.iter().map(|&row| size(row)).sum(),
    };
    let items = kept.iter().take(limit).map(|&row| ListItemDto {
        reason: Some(ReasonDto::from(row)),
        ..ListItemDto::live(tree, base, row.id, baseline)
    });
    // One line per place and per app, however often the walk met it.
    let mut info: Vec<InfoDto> = Vec::new();
    for dto in all
        .info
        .iter()
        .filter_map(|i| InfoDto::of(tree, i, mode, inside))
    {
        if !info.contains(&dto) {
            info.push(dto);
        }
    }
    // A place on the way to an info spot is never in a total.
    let unread = |i: &Info| matches!(i, Info::NoAccess { id, spot: false, .. } if inside(*id));
    let approximate = tree.approximate || all.info.iter().any(unread);
    let cleanup = CleanupDto { info, approximate };
    (items.collect(), kept.len() > limit, found, cleanup)
}

#[cfg(test)]
pub(crate) mod cleanup_tests;
#[cfg(test)]
mod cleanup_walk_tests;
#[cfg(test)]
mod tests;
