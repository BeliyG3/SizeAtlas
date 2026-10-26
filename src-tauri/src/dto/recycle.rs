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
    /// What the recycle bin counts for them: per item the larger of the size on disk and the
    /// length, as the bin check does (cloud-only and compressed files count in full).
    pub bin_size: u64,
    /// Seconds since the Unix epoch.
    pub scanned_at: i64,
    /// Full paths of the first few.
    pub paths: Vec<String>,
    /// Room left in the recycle bin of the root's volume, in bytes; `None` where it cannot be
    /// read (no bin, settings unreadable, macOS and Linux).
    pub bin_free: Option<u64>,
}

/// An item that stayed: `NoTrash` (it would be deleted for good), `Changed` (changed on disk
/// since the scan), `Protected` (a clean-up delete found something it never deletes, or the item
/// is no longer a clean-up row), `NoAccess` (it could not be read) or `Io` (the OS refused, with
/// its message).
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
    /// Items that were gone from the disk already (an earlier request took them, or someone
    /// else): no error, and no longer in the tree.
    pub gone: u32,
    /// Items that stayed, and why.
    pub failed: Vec<TrashFailureDto>,
    /// `CacheNotSaved` when the change could not be saved.
    pub warning: Option<CmdError>,
    /// Stopped by `cancel_trash` before every item was tried: the rest stayed where it was.
    pub stopped: bool,
    /// Never started: stopped by `cancel_trash` of its volume, or the app closed, while it
    /// waited. Nothing was tried.
    pub cancelled: bool,
}

impl TrashDto {
    /// A request that never started.
    pub fn cancelled() -> TrashDto {
        TrashDto {
            removed: 0,
            gone: 0,
            failed: Vec::new(),
            warning: None,
            stopped: true,
            cancelled: true,
        }
    }
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

/// A `trash-progress` event: the progress of the request with the number `request` the UI gave.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TrashProgressEventDto {
    pub request: u64,
    #[serde(flatten)]
    pub progress: TrashProgressDto,
}
