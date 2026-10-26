//! Commands that remove items: to the trash, for good, and the stop of a request. Each request
//! carries the number the UI gave it; its progress comes as `trash-progress` with that number.

use std::path::Path;

use tauri::{AppHandle, Emitter, State};

use super::roots::{cache_dir, changed};
use crate::dto::{TrashDto, TrashProgressDto, TrashProgressEventDto};
use crate::error::CmdError;
use crate::recycle::membership::{self, Disposal};
use crate::recycle::requests::{Work, run_request};
use crate::recycle::{self, run_plan};
use crate::state::{AppState, TrashItem, TrashPlan};
use crate::writes::Turn;

/// Moves items of one tree to the trash after checking them against the disk (see
/// `recycle::run_plan`); refused while a running scan still lists one of them. With
/// `cleanup: true` (from the clean-up modes) the items must be clean-up rows and each is walked
/// again before it goes (see `recycle::membership::run_rows`). Waits for the requests of its
/// volume confirmed before it; reports `trash-progress` once it starts and meanwhile;
/// `cancel_trash` stops it before the next item.
#[tauri::command]
pub async fn trash(
    app: AppHandle,
    state: State<'_, AppState>,
    request: u64,
    generation: u64,
    rev: u64,
    ids: Vec<u32>,
    cleanup: Option<bool>,
) -> Result<TrashDto, CmdError> {
    let cleanup = cleanup == Some(true);
    let plan = move |state: &AppState| {
        if cleanup {
            membership::plan_rows(state, generation, rev, &ids)
        } else {
            state.trash_plan(generation, rev, &ids)
        }
    };
    removing(
        &app,
        &state,
        request,
        generation,
        plan,
        move |state, dir, plan, stop, report| {
            let bin = sizeatlas_core::can_recycle;
            let trash_one = recycle::move_to_trash;
            if cleanup {
                let disposal = Disposal::Trash {
                    bin: &bin,
                    trash_one: &trash_one,
                };
                membership::run_rows(state, dir, generation, plan, disposal, stop, report)
            } else {
                let allowed = |item: &TrashItem| recycle::bin_takes(item, bin);
                run_plan(
                    state, dir, generation, plan, allowed, trash_one, stop, report,
                )
            }
        },
    )
    .await
}

/// Deletes clean-up rows of one tree for good (`recycle::purge::delete`), with the checks of
/// `trash` with `cleanup: true` but no trash check. An id that is no clean-up row refuses the
/// whole request (`Protected`). Queue, progress and `cancel_trash` as `trash`.
#[tauri::command]
pub async fn delete_for_good(
    app: AppHandle,
    state: State<'_, AppState>,
    request: u64,
    generation: u64,
    rev: u64,
    ids: Vec<u32>,
) -> Result<TrashDto, CmdError> {
    let plan = move |state: &AppState| membership::plan_rows(state, generation, rev, &ids);
    removing(
        &app,
        &state,
        request,
        generation,
        plan,
        move |state, dir, plan, stop, report| {
            membership::run_rows(state, dir, generation, plan, Disposal::Purge, stop, report)
        },
    )
    .await
}

/// The progress of a request, as `run` gets it.
type Report<'a> = dyn Fn(TrashProgressDto) + 'a;

/// Registers the request `request` of the tree `generation` and takes its place in the queue of
/// its volume, then plans it (`plan`), so a stop or the exit sees it while it is planned. A
/// refused plan leaves the queue at once. Then `run` removes the items once its turn has come
/// (see `recycle::requests::run_request`), its progress as `trash-progress` events.
async fn removing(
    app: &AppHandle,
    state: &State<'_, AppState>,
    request: u64,
    generation: u64,
    plan: impl FnOnce(&AppState) -> Result<TrashPlan, CmdError> + Send + 'static,
    run: impl FnOnce(
        &AppState,
        &Path,
        TrashPlan,
        &dyn Fn() -> bool,
        &Report,
    ) -> Result<TrashDto, CmdError>
    + Send
    + 'static,
) -> Result<TrashDto, CmdError> {
    let dir = cache_dir(app)?;
    let state = state.inner().clone();
    // The tree is let go at once (see `state::change::tree_mut`).
    let root = state.tree(generation)?.name(0).to_owned();
    let volume = state.volume_of(&root);
    let ticket = state.enqueue_trash(request, &root, &volume)?;
    let turn = Turn::reserve(state.volume_turn(&ticket.volume));
    let planning = state.clone();
    // A refused plan drops the turn, then the ticket; the UI reads the roots again, as after
    // any request.
    let plan = match tauri::async_runtime::spawn_blocking(move || plan(&planning)).await? {
        Ok(plan) => plan,
        Err(error) => {
            drop(turn);
            drop(ticket);
            changed(app);
            return Err(error);
        }
    };
    let events = app.clone();
    let work: Work = Box::new(move |state, dir, stop| {
        let report = |progress| {
            let event = TrashProgressEventDto { request, progress };
            let _ = events.emit("trash-progress", event);
        };
        // The request started: its line in the UI leaves the queue.
        report(TrashProgressDto {
            done: 0,
            total: plan.items.len() as u32,
            current: None,
        });
        run(state, dir, plan, stop, &report)
    });
    let result = run_request(state, dir, ticket, turn, work).await;
    changed(app);
    result
}

/// Stops the request `request` before its next item and cancels the requests waiting on its
/// volume; the items moved stay in the trash. Returns how many waiting requests it cancelled.
#[tauri::command]
pub async fn cancel_trash(state: State<'_, AppState>, request: u64) -> Result<u32, CmdError> {
    Ok(state.stop_volume_of(request))
}
