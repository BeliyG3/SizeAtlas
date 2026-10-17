//! Data sent to the UI (camelCase JSON).

use serde::Serialize;
use sizeatlas_core::tree::{SizeMode, Tree, flags};

use crate::error::CmdError;

mod lists;

pub use lists::{ListDto, ListItemDto, folder_below};

mod recycle;

pub use recycle::{TrashDto, TrashFailureDto, TrashPreviewDto, TrashProgressDto};

/// Milliseconds since the Unix epoch. Core times are nanoseconds, which a JS number cannot
/// hold exactly.
pub fn millis(nanos: i64) -> i64 {
    nanos.div_euclid(1_000_000)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub generation: u64,
    pub rev: u64,
    pub root_id: u32,
    pub root: String,
    pub total: u64,
    pub files: u32,
    pub len: u64,
    pub dirs: u32,
    pub scanned_at: i64,
    pub size_mode: SizeMode,
    pub access_errors: u32,
    pub approximate: bool,
    pub scanning: bool,
    pub volume: Option<VolumeDto>,
}

/// Space of the scanned volume, when the scan root is the root of a volume.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeDto {
    pub total: u64,
    pub free: u64,
    /// Used space the scan did not find.
    pub unaccounted: u64,
}

impl Summary {
    pub fn of(generation: u64, tree: &Tree) -> Summary {
        let root = tree.node(0);
        Summary {
            generation,
            rev: tree.rev,
            root_id: 0,
            root: tree.name(0).to_owned(),
            total: root.size,
            files: root.files,
            len: root.len,
            dirs: root.dirs,
            scanned_at: tree.scanned_at,
            size_mode: tree.size_mode,
            access_errors: tree.access_errors,
            approximate: tree.approximate,
            scanning: root.has(flags::SCANNING),
            volume: tree.volume.map(|v| VolumeDto {
                total: v.total,
                free: v.total.saturating_sub(v.used),
                unaccounted: tree.unaccounted().unwrap_or(0),
            }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDto {
    pub id: u32,
    pub name: String,
    /// Size on disk; for folders, of the whole subtree.
    pub size: u64,
    /// Logical length; for folders, of the whole subtree.
    pub len: u64,
    pub files: u32,
    /// Folders at any depth below this one.
    pub dirs: u32,
    /// Folders directly inside this one.
    pub folders: u32,
    /// Milliseconds since the Unix epoch; 0 if unknown.
    pub modified: i64,
    pub is_dir: bool,
    pub category: u8,
    pub access_error: bool,
    pub cloud: bool,
    pub lossy: bool,
    pub pending: bool,
    pub scanning: bool,
}

impl ItemDto {
    pub fn of(tree: &Tree, id: u32) -> ItemDto {
        let n = tree.node(id);
        ItemDto {
            id,
            name: tree.name(id).to_owned(),
            size: n.size,
            len: n.len,
            files: n.files,
            dirs: n.dirs,
            // ponytail: counts the children of every listed folder; fine for pages of 200 and lists of 1000.
            folders: tree.direct_dirs(id),
            modified: millis(n.mtime),
            is_dir: n.is_dir(),
            category: n.category,
            access_error: n.has(flags::ACCESS_ERROR),
            cloud: n.has(flags::CLOUD),
            lossy: n.has(flags::LOSSY_NAME),
            pending: n.has(flags::PENDING),
            scanning: n.has(flags::SCANNING),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildrenDto {
    pub generation: u64,
    pub rev: u64,
    pub approximate: bool,
    /// Size on disk of the listed folder itself; shares are relative to it.
    pub size: u64,
    pub total: u32,
    pub rest_count: u32,
    pub rest_size: u64,
    pub items: Vec<ItemDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrumbDto {
    pub id: u32,
    pub name: String,
    pub size: u64,
    /// Position among the parent's subfolders in the folder tree's order; lets the UI page down to it.
    pub rank: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeStatDto {
    pub category: u8,
    pub files: u64,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeStatsDto {
    pub generation: u64,
    pub rev: u64,
    pub items: Vec<TypeStatDto>,
}

/// Details of one row read from disk; every field is empty when they are not available.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailDto {
    pub id: u32,
    /// Milliseconds since the Unix epoch.
    pub created: Option<i64>,
    pub accessed: Option<i64>,
    pub attributes: Option<String>,
    pub owner: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailsDto {
    pub generation: u64,
    pub items: Vec<DetailDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressDto {
    /// Root of the running scan.
    pub root: String,
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub current: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QueueState {
    Scanning,
    Queued,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntryDto {
    /// Canonical root.
    pub root: String,
    pub state: QueueState,
    /// The folder a refresh scans again; `None` for a scan of the whole root.
    pub folder: Option<String>,
}

/// Open roots in the order of the folder tree, and the scan queue (the running scan first).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootsDto {
    pub roots: Vec<Summary>,
    pub queue: Vec<QueueEntryDto>,
}

/// A queued scan failed, or its result could not be saved (`CacheNotSaved`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanErrorDto {
    pub root: String,
    pub error: CmdError,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskDto {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
    pub removable: bool,
    /// A mapped network drive (Windows).
    pub network: bool,
    /// False for a network drive that does not answer: it has no sizes.
    pub connected: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedScanDto {
    pub root: String,
    pub scanned_at: i64,
    pub total: u64,
    pub files: u64,
    /// Saved by another format version: only the root is known; scan again.
    pub outdated: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcesDto {
    pub disks: Vec<DiskDto>,
    pub scans: Vec<CachedScanDto>,
}

#[cfg(test)]
mod tests;
