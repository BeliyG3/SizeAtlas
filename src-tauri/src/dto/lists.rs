//! Flat lists of a folder's subtree (see `sizeatlas_core::tree::ListKind`).

use std::path::MAIN_SEPARATOR_STR;

use serde::Serialize;
use sizeatlas_core::tree::Tree;

use super::ItemDto;

/// Folder of `id` relative to its ancestor `base`, its names joined with the OS separator;
/// empty when `id` is directly inside `base`.
pub fn folder_below(tree: &Tree, base: u32, id: u32) -> String {
    let chain = tree.crumbs(id);
    let below = chain.iter().position(|&c| c == base).map_or(0, |p| p + 1);
    chain
        .get(below..chain.len() - 1)
        .unwrap_or_default()
        .iter()
        .map(|&c| tree.name(c))
        .collect::<Vec<_>>()
        .join(MAIN_SEPARATOR_STR)
}

/// An item of a flat list (see `sizeatlas_core::tree::ListKind`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListItemDto {
    #[serde(flatten)]
    pub item: ItemDto,
    /// Folder of the item relative to the listed folder; empty if it is directly inside.
    pub folder: String,
    /// The folder the item is in: selecting a file needs it.
    pub parent: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDto {
    pub generation: u64,
    pub rev: u64,
    /// Size on disk of the listed folder; shares are relative to it.
    pub size: u64,
    /// More items matched than the limit allowed.
    pub truncated: bool,
    pub items: Vec<ListItemDto>,
}
