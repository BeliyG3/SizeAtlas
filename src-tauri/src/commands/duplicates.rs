//! The duplicate search: the estimate before it, the background job and its result. Each runs
//! off the async runtime (the first question about a network share's volume may take a while)
//! and takes no write of a root and no turn of a volume. Then the trash of copies, a request of
//! the removal queue (see `crate::duplicates::trash`).

use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use super::roots::{cache_dir, changed};
use crate::dto::{DuplicatesDto, EstimateDto, RefDto, ScopeDto, TrashDto, TrashProgressEventDto};
use crate::duplicates::{Emit, thumb, trash};
use crate::error::CmdError;
use crate::recycle;
use crate::state::AppState;

/// What a search for `query` (of the folder `scope`, else of every open root) would compare;
/// reads no file. A scope out of date is `StaleId`.
#[tauri::command]
pub async fn estimate_duplicates(
    state: State<'_, AppState>,
    query: String,
    system: bool,
    scope: Option<ScopeDto>,
) -> Result<EstimateDto, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.estimate_duplicates(&query, system, scope.as_ref())
    })
    .await
    .map_err(CmdError::from)?
}

/// Starts a search (of the folder `scope`, else of every open root) and returns its job id at
/// once; its progress comes as `duplicates-status`. A scope out of date is `StaleId`.
#[tauri::command]
pub async fn find_duplicates(
    app: AppHandle,
    state: State<'_, AppState>,
    query: String,
    system: bool,
    scope: Option<ScopeDto>,
) -> Result<u64, CmdError> {
    let state = state.inner().clone();
    let emit: Emit = Arc::new(move |status| {
        let _ = app.emit("duplicates-status", status);
    });
    tauri::async_runtime::spawn_blocking(move || {
        state
            .find_duplicates(query, system, scope, emit)
            .map(|(job, _)| job)
    })
    .await
    .map_err(CmdError::from)?
}

#[tauri::command]
pub async fn cancel_duplicates(state: State<'_, AppState>) -> Result<(), CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.cancel_duplicates())
        .await
        .map_err(CmdError::from)
}

/// What changed in the result after the version `since` of `job` (all of it for another job).
#[tauri::command]
pub async fn get_duplicates(
    state: State<'_, AppState>,
    job: u64,
    since: u64,
) -> Result<DuplicatesDto, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.duplicates_since(job, since))
        .await
        .map_err(CmdError::from)
}

/// Moves the copies `copies` (paths of one group) to the trash; one copy of the group always
/// stays. Refused at once, with nothing registered, while a search runs or when the result or a
/// copy is out of date, protected or the last one. Then it waits for the removals confirmed
/// before it on the volumes of its copies and of the copy that stays; its progress comes as
/// `trash-progress` with `request`, and `cancel_trash(request)` stops it. Afterwards the roots
/// and the search status (the new version, or a stale result) are sent again.
#[tauri::command]
pub async fn trash_duplicates(
    app: AppHandle,
    state: State<'_, AppState>,
    request: u64,
    copies: Vec<RefDto>,
) -> Result<TrashDto, CmdError> {
    let dir = cache_dir(&app)?;
    let state = state.inner().clone();
    let confirmed = trash::confirm(&state, request, &copies)?;
    let events = app.clone();
    let report = move |progress| {
        let event = TrashProgressEventDto { request, progress };
        let _ = events.emit("trash-progress", event);
    };
    let bin = sizeatlas_core::can_recycle;
    let result = trash::run(&state, dir, confirmed, bin, recycle::move_to_trash, report).await;
    changed(&app);
    let _ = app.emit("duplicates-status", state.duplicates_status());
    result
}

/// The bytes of the image file of node `id` for a thumbnail; empty when there is none to show
/// (not an image the webview shows, too large, in the cloud, gone).
#[tauri::command]
pub async fn get_thumbnail(
    state: State<'_, AppState>,
    root: String,
    generation: u64,
    id: u32,
) -> Result<tauri::ipc::Response, CmdError> {
    let state = state.inner().clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        thumb::thumbnail(&state, &root, generation, id)
    })
    .await
    .map_err(CmdError::from)??;
    Ok(tauri::ipc::Response::new(bytes))
}
