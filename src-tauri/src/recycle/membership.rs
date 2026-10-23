//! Deleting clean-up rows: the items of a request must be rows of a clean-up mode now, by a fresh
//! context (never the list's cached walk), and each is walked again on disk right before it goes.

use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use sizeatlas_core::cleanup::{Context, Guard, Reason, Refusal, recheck};

use super::{bin_takes, run_plan};
use crate::dto::{TrashDto, TrashProgressDto};
use crate::error::CmdError;
use crate::state::{AppState, TrashItem, TrashPlan};

/// The trash check of an item by its path and size (`sizeatlas_core::can_recycle`).
pub type BinCheck = dyn Fn(&Path, u64) -> bool;

/// The reason of each item of `plan`, found by a new walk of the tree with `ctx`: an app started
/// since the list was made, or a restart now pending, turns its rows into info, so they are no
/// rows here. `Protected` for the whole request when an item is a row of neither mode.
pub fn rows_of(
    state: &AppState,
    generation: u64,
    plan: &TrashPlan,
    ctx: &Context,
) -> Result<HashMap<u32, Reason>, CmdError> {
    let found = state.tree(generation)?.cleanup(ctx);
    let rows: HashMap<u32, Reason> = (found.cleanup.iter())
        .chain(&found.review)
        .map(|row| (row.id, row.reason))
        .collect();
    let reason = |item: &TrashItem| rows.get(&item.id).map(|&reason| (item.id, reason));
    plan.items
        .iter()
        .map(|item| reason(item).ok_or(CmdError::Protected))
        .collect()
}

/// Deletes the clean-up rows `ids` with `trash_one`: to the trash (`bin` = the trash check,
/// `sizeatlas_core::can_recycle`) or for good (`bin` = `None`, `trash_one` = `purge::delete`).
/// Nothing goes unless every item is a row of a mode by a fresh context ([`rows_of`]). Then, per
/// item and right before it goes, the disk re-check (`recheck` with the never places of that
/// context and the time now) and the trash check; else as `recycle::run_reporting`.
#[allow(clippy::too_many_arguments)]
pub fn run_rows(
    state: &AppState,
    cache_dir: &Path,
    generation: u64,
    rev: u64,
    ids: &[u32],
    bin: Option<&BinCheck>,
    trash_one: impl Fn(&Path) -> Result<(), String>,
    report: impl FnMut(TrashProgressDto),
) -> Result<TrashDto, CmdError> {
    let plan = state.trash_plan(generation, rev, ids)?;
    let ctx = (state.0.context)(Path::new(&plan.root));
    let rows = rows_of(state, generation, &plan, &ctx)?;
    let guard = Guard::new(ctx.os, &ctx.known);
    let stop = || state.trash_stopped() || state.closing();
    let allowed = |item: &TrashItem| {
        let reason = *rows.get(&item.id).ok_or(CmdError::Protected)?;
        recheck(&item.path, reason, &guard, now_ns(), &stop).map_err(refused)?;
        bin.map_or(Ok(()), |bin| bin_takes(item, bin))
    };
    run_plan(
        state, cache_dir, generation, plan, allowed, trash_one, report,
    )
}

/// Why the re-check refused, as the UI is told. Cloud content is `Protected` like any never
/// place; an item gone meanwhile is `Changed`, as the trash check says.
pub(crate) fn refused(refusal: Refusal) -> CmdError {
    match refusal {
        Refusal::Protected => CmdError::Protected,
        Refusal::Changed => CmdError::Changed,
        Refusal::NoAccess(_, e) if e.kind() == io::ErrorKind::NotFound => CmdError::Changed,
        Refusal::NoAccess(path, e) => CmdError::io(&path, e),
        // `run_plan` sees the stop itself and ends the request; the item was not tried.
        Refusal::Stopped => CmdError::Busy,
    }
}

/// Nanoseconds since the epoch; 0 (unknown: every Temp item young) before it.
fn now_ns() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_nanos()).unwrap_or(i64::MAX))
}
