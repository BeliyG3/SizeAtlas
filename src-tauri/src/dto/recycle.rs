//! Moving items to the trash: what the confirmation shows and what happened.

use serde::Serialize;

use crate::error::CmdError;

/// What a trash request would move, for its confirmation.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashPreviewDto {
    /// Items that would go, without those inside another one.
    pub count: u32,
    /// Size on disk of all of them.
    pub size: u64,
    /// Seconds since the Unix epoch.
    pub scanned_at: i64,
    /// Full paths of the first few.
    pub paths: Vec<String>,
}

/// An item that stayed: `NoTrash` (it would be deleted for good), `Changed` (changed on disk
/// since the scan), `NoAccess` (it could not be read) or `Io` (the OS refused, with its message).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashFailureDto {
    pub path: String,
    pub error: CmdError,
}

/// What a trash request did.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashDto {
    pub removed: u32,
    /// Items that stayed, and why.
    pub failed: Vec<TrashFailureDto>,
    /// `CacheNotSaved` when the change could not be saved.
    pub warning: Option<CmdError>,
    /// Stopped by `cancel_trash` before every item was tried: the rest stayed where it was.
    pub stopped: bool,
}

/// How far a trash request got: `done` of `total` items were tried; `current` goes next (none
/// once it ended).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashProgressDto {
    pub done: u32,
    pub total: u32,
    pub current: Option<String>,
}
