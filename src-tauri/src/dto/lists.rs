//! Flat lists of a folder's subtree (see `sizeatlas_core::tree::ListKind`).

use std::path::MAIN_SEPARATOR_STR;

use serde::Serialize;
use sizeatlas_core::baseline::Baseline;
use sizeatlas_core::categories::DIR_CATEGORY;
use sizeatlas_core::tree::Tree;

use super::{ChangeDto, CleanupDto, ItemDto, ReasonDto};

/// Folder of `id` relative to its ancestor `base`, its names joined with the OS separator;
/// empty when `id` is directly inside `base`.
fn folder_below(tree: &Tree, base: u32, id: u32) -> String {
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
    /// A folder the baseline had and the tree has no more (only in `GrewMost`).
    pub deleted: bool,
    /// Why the item is listed (only in `Cleanup` and `Review`).
    pub reason: Option<ReasonDto>,
}

impl ListItemDto {
    /// The live node `id` below `base`.
    pub fn live(tree: &Tree, base: u32, id: u32, baseline: Option<&Baseline>) -> ListItemDto {
        ListItemDto {
            // Actions on the item need its whole path to be exact.
            item: ItemDto {
                lossy: tree.has_lossy_path(id),
                ..ItemDto::of(tree, id, baseline)
            },
            folder: folder_below(tree, base, id),
            parent: tree.node(id).parent,
            deleted: false,
            reason: None,
        }
    }

    /// A deleted folder of `size` in the baseline, which was `name` inside `parent` (`base` or a
    /// folder below it). `id` only tells rows apart: it is never a node.
    pub fn deleted(
        tree: &Tree,
        base: u32,
        id: u32,
        (parent, name, size): (u32, &str, u64),
        approx: bool,
    ) -> ListItemDto {
        let mut folder = folder_below(tree, base, parent);
        if parent != base {
            if !folder.is_empty() {
                folder.push_str(MAIN_SEPARATOR_STR);
            }
            folder.push_str(tree.name(parent));
        }
        ListItemDto {
            item: ItemDto {
                id,
                name: name.to_owned(),
                size: 0,
                len: 0,
                files: 0,
                dirs: 0,
                folders: 0,
                modified: 0,
                is_dir: true,
                category: DIR_CATEGORY,
                access_error: false,
                cloud: false,
                lossy: tree.has_lossy_path(parent),
                pending: false,
                scanning: false,
                before: Some(size),
                change: Some(ChangeDto::Delta(super::delta(0, size))),
                approx_change: approx,
            },
            folder,
            parent,
            deleted: true,
            reason: None,
        }
    }
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
    /// Totals of a search or of a clean-up mode; `None` for every other list.
    pub found: Option<FoundDto>,
    /// The info and accuracy of a clean-up mode; `None` for every other list.
    pub cleanup: Option<CleanupDto>,
    /// As in [`super::Summary`].
    pub baseline_at: Option<i64>,
    pub baseline_rev: u64,
    pub baseline_pending: bool,
}

/// What a search or a clean-up mode found in all, not just in the `items` that fit the limit.
/// Clean-up rows never nest, so there each row counts once.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundDto {
    /// Every match, a folder and the items inside it each counted.
    pub count: u64,
    /// Size on disk of the matches, an item inside a matching folder not counted twice.
    pub size: u64,
}
