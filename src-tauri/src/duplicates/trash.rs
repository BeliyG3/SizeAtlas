//! The trash of duplicates: one request for copies of one group, possibly from several roots.
//! Confirmed against the result in memory (`confirm`), queued on the volumes of its copies and
//! of the copy that stays, decided as a whole once its turns came (`decide`), then moved root by
//! root through `recycle::move_plan`; what left the disk leaves the result, by the journal of
//! each root. One copy of the group always stays.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use sizeatlas_core::duplicates::group::PathRef;
use sizeatlas_core::duplicates::results::Results;

use super::decide::{self, Decision, Planned};
use super::select::{self, BatchRoot};
use crate::dto::{RefDto, StatusDto, TrashDto, TrashProgressDto};
use crate::error::CmdError;
use crate::recycle::requests::{Ticket, Work, run_batch};
use crate::recycle::{bin_takes, move_plan};
use crate::state::{AppState, TrashItem};
use crate::writes::Turn;

/// A trash request of duplicates is registered while this lives (a search is refused).
struct Trashing(AppState);

impl Drop for Trashing {
    fn drop(&mut self) {
        // No lock: it may go while `Inner` is held.
        (self.0.0.duplicates.trashing).fetch_sub(1, Ordering::AcqRel);
    }
}

/// A confirmed request: registered with a ticket per root, queued on every volume it needs.
pub struct Confirmed {
    tickets: Vec<Ticket>,
    turns: Vec<Turn>,
    refs: Vec<PathRef>,
    /// The copy that stays.
    keep: PathRef,
    trashing: Trashing,
}

/// Confirms the request `request` to move the copies `refs` (paths of one group) to the trash,
/// in memory and under one lock of the result: `Busy` while a search runs, `StaleId` when the
/// result or a ref is out of date (freshness is left to the decision while another request of
/// duplicates is registered: its removals move the revisions before it updates the result),
/// `Protected`/`LastCopy` as `decide::select`. A refusal registers nothing.
pub fn confirm(state: &AppState, request: u64, refs: &[RefDto]) -> Result<Confirmed, CmdError> {
    let inner = state.duplicates();
    if inner.running.is_some() {
        return Err(CmdError::Busy);
    }
    let trashing = &state.0.duplicates.trashing;
    if trashing.load(Ordering::Acquire) == 0 && state.stale_in(&inner) {
        return Err(CmdError::StaleId);
    }
    let results = inner.results.as_ref().ok_or(CmdError::StaleId)?;
    let refs = (refs.iter())
        .map(|r| path_ref(results, r))
        .collect::<Result<Vec<_>, _>>()?;
    let batch = select::select(results, &inner.volumes, &refs, None)?;
    let roots: Vec<(String, String)> = (batch.roots.iter())
        .map(|r| (r.mark.path.clone(), r.volume.clone()))
        .collect();
    let tickets = state.enqueue_batch(request, &roots)?;
    let volumes: Vec<String> = (roots.into_iter().map(|(_, volume)| volume))
        .chain(batch.keep_volumes)
        .collect();
    let turns = state.reserve_turns(&volumes);
    // Last: a refusal above leaves no trace.
    trashing.fetch_add(1, Ordering::AcqRel);
    Ok(Confirmed {
        tickets,
        turns,
        refs,
        keep: batch.keep.at,
        trashing: Trashing(state.clone()),
    })
}

/// The path of `r` in `results`: the root with its path and generation.
fn path_ref(results: &Results, r: &RefDto) -> Result<PathRef, CmdError> {
    let root = (results.roots.iter())
        .position(|m| m.path == r.root && m.generation == r.generation)
        .and_then(|i| u16::try_from(i).ok())
        .ok_or(CmdError::StaleId)?;
    Ok(PathRef { root, node: r.id })
}

/// Runs the confirmed request once its turns have come (`requests::run_batch`): the decision,
/// then the copies, each checked right before it goes, through `trash_one` if `bin` says the
/// system trash takes it. `report` gets one count for the whole request (see `execute`). The
/// request stays registered until every root was saved and compacted.
pub async fn run(
    state: &AppState,
    cache_dir: PathBuf,
    confirmed: Confirmed,
    bin: impl Fn(&Path, u64) -> bool + Send + 'static,
    trash_one: impl Fn(&Path) -> Result<(), String> + Send + 'static,
    report: impl Fn(TrashProgressDto) + Send + 'static,
) -> Result<TrashDto, CmdError> {
    let Confirmed {
        tickets,
        turns,
        refs,
        keep,
        trashing,
    } = confirmed;
    let roots: Vec<String> = tickets.iter().map(|t| t.root.clone()).collect();
    let work: Work = Box::new(move |state, dir, stop| {
        let stop = || stop() || state.closing();
        match decide::decide(state, &refs, keep, &roots, &stop, &report)? {
            Some(decision) => Ok(execute(
                state, dir, decision, &bin, &trash_one, &stop, &report,
            )),
            None => Ok(TrashDto {
                cancelled: false,
                ..TrashDto::cancelled()
            }),
        }
    });
    let result = run_batch(state.clone(), cache_dir, tickets, turns, work).await;
    drop(trashing);
    result
}

/// Moves the plans of `d` root by root. Before each root a stop (or the exit) leaves the rest;
/// what moved stays moved and leaves the result. Progress: `done` counts on from the roots
/// before, out of the items of all plans, and one last event (`current: None`) ends it.
fn execute(
    state: &AppState,
    dir: &Path,
    d: Decision,
    bin: &dyn Fn(&Path, u64) -> bool,
    trash_one: &dyn Fn(&Path) -> Result<(), String>,
    stop: &dyn Fn() -> bool,
    report: &dyn Fn(TrashProgressDto),
) -> TrashDto {
    let (keep_id, total) = (d.keep_id, d.total);
    let mut sum = TrashDto {
        stopped: false,
        cancelled: false,
        ..TrashDto::cancelled()
    };
    let mut done = 0;
    for Planned { root, plan, ids } in d.roots {
        if stop() {
            sum.stopped = true;
            break;
        }
        let allowed = |item: &TrashItem| {
            let recorded = ids.get(&item.id).copied().ok_or(CmdError::Changed)?;
            decide::still(&item.path, item.len, item.mtime, recorded, keep_id)?;
            bin_takes(item, bin)
        };
        let offset = done;
        let progress = |p: TrashProgressDto| {
            if p.current.is_some() {
                let (done, current) = (offset + p.done, p.current);
                report(TrashProgressDto {
                    done,
                    total,
                    current,
                });
            }
        };
        let generation = root.mark.generation;
        let (moved, journal) = move_plan(
            state, dir, generation, plan, allowed, trash_one, stop, progress,
        );
        done += moved.removed + moved.gone + moved.failed.len() as u32;
        settle(state, &root, &journal);
        merge(&mut sum, moved);
    }
    // Unix only can see a change here: Windows held the file closed to writes and deletes.
    if !d.held.unchanged(&d.keep) && sum.warning.is_none() {
        sum.warning = Some(CmdError::Changed);
    }
    drop(d.held);
    report(TrashProgressDto {
        done,
        total,
        current: None,
    });
    sum
}

/// Takes the nodes of `journal` (they left the disk) out of the result, and gives the mark of
/// the root the revision its tree has now, unless the root was closed or replaced meanwhile:
/// then the result is stale.
fn settle(state: &AppState, root: &BatchRoot, journal: &[u32]) {
    let same =
        |s: &crate::dto::Summary| s.root == root.mark.path && s.generation == root.mark.generation;
    let rev = state.summaries().into_iter().find(same).map(|s| s.rev);
    let gone: Vec<PathRef> = (journal.iter())
        .map(|&node| PathRef {
            root: root.index,
            node,
        })
        .collect();
    let mut inner = state.duplicates();
    let Some(results) = inner.results.as_mut() else {
        return;
    };
    results.remove(&gone);
    let mark = results.roots.get_mut(usize::from(root.index));
    if let (Some(rev), Some(mark)) = (rev, mark)
        && mark.generation == root.mark.generation
    {
        mark.rev = rev;
    }
}

/// Adds what one root did to the request's result.
fn merge(sum: &mut TrashDto, moved: TrashDto) {
    sum.removed += moved.removed;
    sum.gone += moved.gone;
    sum.size = sum.size.saturating_add(moved.size);
    sum.failed.extend(moved.failed);
    sum.warning = sum.warning.take().or(moved.warning);
    sum.stopped |= moved.stopped;
}

impl AppState {
    /// The status of the search with the version the result has now, for `duplicates-status`
    /// after a trash of duplicates.
    pub(crate) fn duplicates_status(&self) -> StatusDto {
        let inner = self.duplicates();
        let version = inner.results.as_ref().map_or(0, |r| r.version);
        StatusDto {
            version,
            ..inner.status.clone()
        }
    }
}
