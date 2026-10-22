//! Order of a directory listing: one comparator for pages, positions and ranks.

use std::cmp::Ordering;

use serde::Deserialize;

use super::Tree;

/// What a listing is sorted by. `Size` is the size on disk, `Len` the logical length.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
    Name,
    Size,
    Len,
    Files,
    Dirs,
    Modified,
    /// Change since the previous full scan. The tree does not know it: the app sorts by it, the
    /// tree lists by name.
    Change,
}

/// Sort key and direction of a listing, and whether it lists folders only.
/// Ties are broken by name bytes, then by id, both ascending whatever the direction.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOrder {
    pub key: SortKey,
    pub descending: bool,
    pub dirs_only: bool,
}

impl ListOrder {
    /// Largest on disk first, files and folders together.
    pub const DEFAULT: ListOrder = ListOrder {
        key: SortKey::Size,
        descending: true,
        dirs_only: false,
    };
    /// The folder tree: folders only, by name (ASCII case ignored), as Folder Size lists them.
    pub const FOLDERS: ListOrder = ListOrder {
        key: SortKey::Name,
        descending: false,
        dirs_only: true,
    };
}

impl Tree {
    /// Whether `id` appears in listings made with `order`.
    pub(super) fn listed(&self, id: u32, order: ListOrder) -> bool {
        !order.dirs_only || self.nodes[id as usize].is_dir()
    }

    /// Compares two nodes as a listing made with `order` does.
    pub(super) fn compare(&self, a: u32, b: u32, order: ListOrder) -> Ordering {
        let (x, y) = (&self.nodes[a as usize], &self.nodes[b as usize]);
        let primary = match order.key {
            SortKey::Name => folded(&x.name).cmp(folded(&y.name)),
            SortKey::Size => x.size.cmp(&y.size),
            SortKey::Len => x.len.cmp(&y.len),
            SortKey::Files => x.files.cmp(&y.files),
            SortKey::Dirs => x.dirs.cmp(&y.dirs),
            SortKey::Modified => x.mtime.cmp(&y.mtime),
            SortKey::Change => Ordering::Equal,
        };
        let primary = if order.descending {
            primary.reverse()
        } else {
            primary
        };
        primary
            .then_with(|| x.name.as_bytes().cmp(y.name.as_bytes()))
            .then(a.cmp(&b))
    }
}

/// Name bytes with ASCII letters lowercased: a cheap case-insensitive name order.
fn folded(name: &str) -> impl Iterator<Item = u8> + '_ {
    name.bytes().map(|b| b.to_ascii_lowercase())
}
