//! The decision for a whole trash request of duplicates, once all its turns have come: the
//! result still fresh (`select::fresh`), the copy that stays hashed again and held open, every
//! copy to remove checked against the disk, the plans of all roots made and checked, the result
//! checked once more. Nothing moves before the decision; a refusal moves nothing.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use sizeatlas_core::duplicates::group::{Location, PathRef};
use sizeatlas_core::duplicates::hash::open_checked;
use sizeatlas_core::duplicates::{FileId, Held, Skip, rehash_held};

use super::select::{BatchRoot, Copy, fresh};
use crate::dto::TrashProgressDto;
use crate::error::CmdError;
use crate::recycle::check_plan;
use crate::state::{AppState, TrashPlan};

/// The plan of one root of the batch.
pub(super) struct Planned {
    pub root: BatchRoot,
    pub plan: TrashPlan,
    /// The id the search read for each node to remove.
    pub ids: HashMap<u32, FileId>,
}

/// What the batch does once nothing refused it.
pub(super) struct Decision {
    /// In ascending order of the root paths.
    pub roots: Vec<Planned>,
    pub keep: PathBuf,
    /// The id of the copy that stays as it is open now.
    pub keep_id: FileId,
    /// Open until the last copy has moved.
    pub held: Held,
    /// The items of all plans.
    pub total: u32,
}

/// The decision for the batch (`refs` with the copy at `keep` that stays, of the roots
/// `roots`), made with every turn and write of the batch held, before anything moves.
/// `Ok(None)` when `stop` said so meanwhile: nothing moved.
pub(super) fn decide(
    state: &AppState,
    refs: &[PathRef],
    keep: PathRef,
    roots: &[String],
    stop: &dyn Fn() -> bool,
    report: &dyn Fn(TrashProgressDto),
) -> Result<Option<Decision>, CmdError> {
    let batch = fresh(state, &state.duplicates(), refs, keep, roots)?;
    let total: usize = batch.copies.iter().map(|c| c.paths.len()).sum();
    let total = total as u32;
    report(TrashProgressDto {
        done: 0,
        total,
        current: Some(batch.keep.path.display().to_string()),
    });
    let changed = || {
        if let Some(r) = state.duplicates().results.as_mut() {
            r.mark_stale(&batch.hash);
        }
        CmdError::Changed
    };
    let k = &batch.keep;
    let held = match rehash_held(&k.path, k.len, k.mtime, stop, &mut |_| ()) {
        Ok((hash, held)) if hash == batch.hash => held,
        Err(_) if stop() => return Ok(None),
        _ => return Err(changed()),
    };
    // The copy that stays is the file the search saw; nothing to remove is that file.
    let keep_id = held.identity().id.filter(|&id| id == batch.keep_id);
    let keep_id = keep_id.ok_or_else(changed)?;
    for copy in &batch.copies {
        for p in &copy.paths {
            same_file(p, copy, keep_id)?;
        }
    }
    if !held.unchanged(&k.path) {
        return Err(changed());
    }
    let mut planned = Vec::with_capacity(batch.roots.len());
    for root in &batch.roots {
        if stop() {
            return Ok(None);
        }
        let paths = (batch.copies.iter())
            .flat_map(|c| c.paths.iter().map(move |p| (p, c.id)))
            .filter(|(p, _)| p.at.root == root.index);
        let ids: HashMap<u32, FileId> = paths.map(|(p, id)| (p.at.node, id)).collect();
        let nodes: Vec<u32> = ids.keys().copied().collect();
        let plan = state.trash_plan(root.mark.generation, root.mark.rev, &nodes)?;
        planned.push(Planned {
            root: root.clone(),
            plan,
            ids,
        });
    }
    for p in &planned {
        if stop() {
            return Ok(None);
        }
        check_plan(state, &p.plan)?;
    }
    if stop() {
        return Ok(None);
    }
    // The point of freshness: the result as it is right before the first move.
    let now = fresh(state, &state.duplicates(), refs, keep, roots)?;
    if now.roots != batch.roots {
        return Err(CmdError::StaleId);
    }
    Ok(Some(Decision {
        roots: planned,
        keep: batch.keep.path,
        keep_id,
        held,
        total,
    }))
}

/// The path `p` of `copy` is still that copy and not the file that stays (`keep`): checked by
/// what is on disk now. A path gone meanwhile passes: it stays in the plan and counts as gone.
fn same_file(p: &Location, copy: &Copy, keep: FileId) -> Result<(), CmdError> {
    match fs::symlink_metadata(&p.path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => return Err(no_access(&p.path)),
        Err(_) => return Err(CmdError::Changed),
        Ok(_) => {}
    }
    let nlink = still(&p.path, p.len, p.mtime, copy.id, keep)?;
    // A link made since the search, outside the found paths: removing these frees nothing.
    if nlink > copy.paths.len() as u64 {
        return Err(CmdError::Protected);
    }
    Ok(())
}

/// The file at `path` is still the regular file of `len` bytes and time `mtime` with the id
/// `recorded`, and not the file that stays (`keep`: `LastCopy`); returns its number of links.
pub(super) fn still(
    path: &Path,
    len: u64,
    mtime: i64,
    recorded: FileId,
    keep: FileId,
) -> Result<u64, CmdError> {
    let (_file, identity, _) = open_checked(path, len, mtime).map_err(|s| skip(s, path))?;
    match identity.id {
        Some(id) if id == keep => Err(CmdError::LastCopy),
        Some(id) if id == recorded => Ok(identity.nlink),
        _ => Err(CmdError::Changed),
    }
}

fn skip(skip: Skip, path: &Path) -> CmdError {
    match skip {
        Skip::NoAccess => no_access(path),
        Skip::Cloud | Skip::Changed | Skip::Failed => CmdError::Changed,
    }
}

fn no_access(path: &Path) -> CmdError {
    CmdError::NoAccess {
        path: path.display().to_string(),
    }
}
