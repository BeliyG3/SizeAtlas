//! The duplicate search: its progress, its result read by cursor, and the estimate before it.

use serde::{Deserialize, Serialize};
use sizeatlas_core::categories::categorize;
use sizeatlas_core::duplicates::group::{Group, Object};
use sizeatlas_core::duplicates::hash::Hash;
use sizeatlas_core::duplicates::results::RootMark;
use sizeatlas_core::duplicates::{Phase, Unread};

use super::millis;

/// Where a search job is; the payload of the `duplicates-status` event.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusDto {
    pub job: u64,
    /// The version of the result when this was sent.
    pub version: u64,
    pub running: bool,
    /// The result is out of date (see `DuplicatesDto::stale`) as this was sent.
    pub stale: bool,
    /// `None` before the first progress.
    pub phase: Option<Phase>,
    pub files_done: u64,
    pub files_total: u64,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

/// One path of a copy: node `id` of the tree of `root` with `generation`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefDto {
    pub root: String,
    pub generation: u64,
    pub id: u32,
}

/// One file of a group: every found path of it (hard links), shown by its first.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyDto {
    pub refs: Vec<RefDto>,
    pub path: String,
    pub root: String,
    /// Milliseconds since the Unix epoch; 0 when unknown.
    pub mtime: i64,
    pub size: u64,
    /// Lies in a zone: never removed here.
    pub protected: bool,
    /// Has links outside the found paths: removing it frees nothing.
    pub hardlink: bool,
    /// Lies in a cloud sync folder.
    pub synced: bool,
    /// Its file id could not be told: neither kept nor removed.
    pub no_id: bool,
    pub trashable: bool,
}

/// Files of equal content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDto {
    /// The whole-file hash, in hex.
    pub key: String,
    pub len: u64,
    /// The size on disk of a copy (the largest).
    pub size: u64,
    /// At most what removing copies frees.
    pub free: u64,
    /// The file name of one of the copies.
    pub name: String,
    /// See `sizeatlas_core::categories::Category`.
    pub category: u8,
    pub stale: bool,
    pub copies: Vec<CopyDto>,
}

/// What changed in the result after the cursor the UI gave (all of it when `full`).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatesDto {
    /// 0 without a result.
    pub job: u64,
    pub version: u64,
    pub running: bool,
    /// Not cancelled.
    pub complete: bool,
    /// A searched root changed, closed, or another one opened: search again before removing.
    pub stale: bool,
    /// `groups` is the whole result, not a change.
    pub full: bool,
    pub query: String,
    pub system: bool,
    pub groups: Vec<GroupDto>,
    /// Keys of groups gone.
    pub removed: Vec<String>,
    pub unread: Unread,
    /// Roots left out: they were being scanned.
    pub skipped: Vec<String>,
    pub status: StatusDto,
}

/// What a search would compare, before it starts.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstimateDto {
    pub files: u64,
    pub bytes: u64,
    pub eligible: u64,
    pub seeded: u64,
    pub roots: u32,
    pub skipped: Vec<String>,
}

pub fn hex(hash: &Hash) -> String {
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

impl GroupDto {
    /// `group` of a result of the roots `roots` (`PathRef::root` indexes them).
    pub fn of(group: &Group, roots: &[RootMark]) -> GroupDto {
        let name = group
            .objects
            .first()
            .and_then(|o| o.paths.first())
            .and_then(|p| p.path.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        GroupDto {
            key: hex(&group.hash),
            len: group.len,
            size: group.objects.iter().map(Object::size).max().unwrap_or(0),
            free: group.free(),
            category: categorize(&name) as u8,
            name,
            stale: group.stale,
            copies: group.objects.iter().map(|o| copy(o, roots)).collect(),
        }
    }
}

fn copy(object: &Object, roots: &[RootMark]) -> CopyDto {
    let root = |at: u16| &roots[usize::from(at)];
    let first = object.paths.first();
    CopyDto {
        refs: (object.paths.iter())
            .map(|p| RefDto {
                root: root(p.at.root).path.clone(),
                generation: root(p.at.root).generation,
                id: p.at.node,
            })
            .collect(),
        path: first
            .map(|p| p.path.display().to_string())
            .unwrap_or_default(),
        root: first
            .map(|p| root(p.at.root).path.clone())
            .unwrap_or_default(),
        mtime: first.map_or(0, |p| millis(p.mtime)),
        size: object.size(),
        protected: object.protected,
        hardlink: object.outside_links(),
        synced: object.synced,
        no_id: object.id.is_none(),
        trashable: object.trashable(),
    }
}
