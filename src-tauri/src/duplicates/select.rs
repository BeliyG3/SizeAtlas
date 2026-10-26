//! What a trash request of duplicates removes and which copy stays, read from the result in
//! memory: at the confirmation, and again with every turn of the request held, before anything
//! moves (see `decide`).

use sizeatlas_core::duplicates::FileId;
use sizeatlas_core::duplicates::group::{Group, Location, PathRef};
use sizeatlas_core::duplicates::hash::Hash;
use sizeatlas_core::duplicates::results::{Results, RootMark};

use super::Inner;
use crate::error::CmdError;
use crate::state::AppState;

/// A root of the batch: its index among the searched roots, its mark and its trash queue.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct BatchRoot {
    pub index: u16,
    pub mark: RootMark,
    pub volume: String,
}

/// A copy to remove: every path of the file and the id the search read.
pub(super) struct Copy {
    pub id: FileId,
    pub paths: Vec<Location>,
}

/// The copies to remove, all of one group, and the copy that stays.
pub(super) struct Batch {
    pub hash: Hash,
    pub copies: Vec<Copy>,
    /// The path of the copy that stays that is hashed again.
    pub keep: Location,
    pub keep_id: FileId,
    /// The roots of the copies, in ascending order of their path.
    pub roots: Vec<BatchRoot>,
    /// The trash queues of every searched root that holds the copy that stays (its own root
    /// and the roots around it): a removal of a folder that holds it waits for the batch.
    pub keep_volumes: Vec<String>,
}

/// The batch `refs` names in the result: each copy with all its paths, all of one group
/// (`Protected` otherwise), each one removable (`Protected`). The copy that stays is the one at
/// `keep`, or with `None` the first copy that may stay on a volume of the batch, else the first
/// (`LastCopy` when none may). A ref, or `keep`, the result no longer has: `StaleId`.
pub(super) fn select(
    results: &Results,
    volumes: &[String],
    refs: &[PathRef],
    keep: Option<PathRef>,
) -> Result<Batch, CmdError> {
    let mut group = None;
    let mut taken = Vec::new();
    for &at in refs {
        let (g, i) = results.find(at).ok_or(CmdError::StaleId)?;
        if group.is_some_and(|h: &Group| h.hash != g.hash) {
            return Err(CmdError::Protected);
        }
        group = Some(g);
        if !taken.contains(&i) {
            taken.push(i);
        }
    }
    let group = group.ok_or(CmdError::StaleId)?;
    let volume_of = |p: &Location| volumes.get(usize::from(p.at.root)).cloned();
    let mut copies = Vec::new();
    let mut roots: Vec<BatchRoot> = Vec::new();
    for &i in &taken {
        let object = &group.objects[i];
        let id = object.id.filter(|_| object.trashable());
        let id = id.ok_or(CmdError::Protected)?;
        for p in &object.paths {
            let mark = results.roots.get(usize::from(p.at.root));
            let (mark, volume) = mark.zip(volume_of(p)).ok_or(CmdError::StaleId)?;
            if !roots.iter().any(|r| r.index == p.at.root) {
                let (index, mark) = (p.at.root, mark.clone());
                roots.push(BatchRoot {
                    index,
                    mark,
                    volume,
                });
            }
        }
        copies.push(Copy {
            id,
            paths: object.paths.clone(),
        });
    }
    roots.sort_by(|a, b| a.mark.path.cmp(&b.mark.path));
    let mut keepers = (group.objects.iter().enumerate())
        .filter(|(i, o)| !taken.contains(i) && o.keepable())
        .flat_map(|(_, o)| o.paths.iter().map(move |p| (o, p)));
    let on_batch = |p: &Location| volume_of(p).is_some_and(|v| roots.iter().any(|r| r.volume == v));
    let kept = match keep {
        Some(at) => keepers.find(|(_, p)| p.at == at).ok_or(CmdError::StaleId)?,
        None => {
            let all: Vec<_> = keepers.collect();
            let near = all.iter().find(|(_, p)| on_batch(p));
            *near.or(all.first()).ok_or(CmdError::LastCopy)?
        }
    };
    let (object, keep) = (kept.0, kept.1.clone());
    let keep_volumes = (results.roots.iter().zip(volumes))
        .filter(|(mark, _)| keep.path.starts_with(&mark.path))
        .map(|(_, volume)| volume.clone())
        .collect();
    Ok(Batch {
        hash: group.hash,
        copies,
        keep,
        keep_id: object.id.ok_or(CmdError::StaleId)?,
        roots,
        keep_volumes,
    })
}

/// [`select`] at `keep` from the result as it is now, if it is still fresh; only within the
/// roots the request registered (`roots`, the paths of its tickets).
pub(super) fn fresh(
    state: &AppState,
    inner: &Inner,
    refs: &[PathRef],
    keep: PathRef,
    roots: &[String],
) -> Result<Batch, CmdError> {
    if state.stale_in(inner) {
        return Err(CmdError::StaleId);
    }
    let results = inner.results.as_ref().ok_or(CmdError::StaleId)?;
    let batch = select(results, &inner.volumes, refs, Some(keep))?;
    if !batch.roots.iter().all(|r| roots.contains(&r.mark.path)) {
        return Err(CmdError::StaleId);
    }
    Ok(batch)
}
