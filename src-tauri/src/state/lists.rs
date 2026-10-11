//! Flat lists of the contents table (see `sizeatlas_core::tree::ListKind`).

use sizeatlas_core::tree::ListKind;

use super::AppState;
use crate::dto::{ItemDto, ListDto, ListItemDto, folder_below};
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
        self.with_live(generation, id, |tree| {
            let found = tree.list(id, kind, limit.min(MAX_LIST) as usize);
            ListDto {
                generation,
                rev: tree.rev,
                size: tree.node(id).size,
                truncated: found.truncated,
                items: found
                    .items
                    .into_iter()
                    .map(|node| ListItemDto {
                        // Actions on the item need its whole path to be exact.
                        item: ItemDto {
                            lossy: tree.has_lossy_path(node),
                            ..ItemDto::of(tree, node)
                        },
                        folder: folder_below(tree, id, node),
                        parent: tree.node(node).parent,
                    })
                    .collect(),
            }
        })
    }
}

#[cfg(test)]
mod tests;
