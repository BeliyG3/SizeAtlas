//! The duplicate search: the estimate before it, the background job and its result. Each runs
//! off the async runtime (the first question about a network share's volume may take a while)
//! and takes no write of a root and no turn of a volume.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::dto::{DuplicatesDto, EstimateDto};
use crate::duplicates::Emit;
use crate::error::CmdError;
use crate::state::AppState;

/// What a search for `query` would compare; reads no file.
#[tauri::command]
pub async fn estimate_duplicates(
    state: State<'_, AppState>,
    query: String,
    system: bool,
) -> Result<EstimateDto, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.estimate_duplicates(&query, system))
        .await
        .map_err(CmdError::from)
}

/// Starts a search and returns its job id at once; its progress comes as `duplicates-status`.
#[tauri::command]
pub async fn find_duplicates(
    app: AppHandle,
    state: State<'_, AppState>,
    query: String,
    system: bool,
) -> Result<u64, CmdError> {
    let state = state.inner().clone();
    let emit: Emit = Arc::new(move |status| {
        let _ = app.emit("duplicates-status", status);
    });
    tauri::async_runtime::spawn_blocking(move || {
        state
            .find_duplicates(query, system, emit)
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
