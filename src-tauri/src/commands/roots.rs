//! Commands that change the open roots and the scan queue; each reports `roots-changed`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::dto::{RootsDto, ScanErrorDto, SourcesDto, Summary, TrashDto, TrashProgressDto};
use crate::error::CmdError;
use crate::queue::ScanJob;
use crate::state::AppState;
use crate::worker::{self, Notice, Notify};
use crate::{jobs, recycle, sources};

const ROOTS_CHANGED: &str = "roots-changed";

fn cache_dir(app: &AppHandle) -> Result<PathBuf, CmdError> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("scans"))
        .map_err(|e| CmdError::Io {
            path: "app data".into(),
            os_message: e.to_string(),
        })
}

fn changed(app: &AppHandle) {
    let _ = app.emit(ROOTS_CHANGED, ());
}

/// Turns the worker's notices into events for the UI.
fn notifier(app: &AppHandle) -> Notify {
    let app = app.clone();
    Arc::new(move |notice| {
        let _ = match notice {
            Notice::RootsChanged => app.emit(ROOTS_CHANGED, ()),
            Notice::LiveChanged => app.emit("live-tree-changed", ()),
            Notice::Progress(progress) => app.emit("scan-progress", progress),
            Notice::Failed { root, error } => app.emit("scan-error", ScanErrorDto { root, error }),
        };
    })
}

/// Starts the worker with `job`: the job to run when the queue was idle.
fn start(app: &AppHandle, state: &AppState, dir: PathBuf, job: Option<ScanJob>) {
    if let Some(job) = job {
        tauri::async_runtime::spawn(worker::run(state.clone(), dir, job, notifier(app)));
    }
}

#[tauri::command]
pub async fn list_sources(app: AppHandle) -> Result<SourcesDto, CmdError> {
    let dir = cache_dir(&app)?;
    Ok(tauri::async_runtime::spawn_blocking(move || sources::list(&dir)).await?)
}

#[tauri::command]
pub async fn list_roots(state: State<'_, AppState>) -> Result<RootsDto, CmdError> {
    Ok(state.roots())
}

/// Queues a scan of `path` and returns its canonical root at once; a root that is scanning
/// or waiting already is not queued again. Progress and failures come as events.
#[tauri::command]
pub async fn scan(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<String, CmdError> {
    let dir = cache_dir(&app)?;
    let root = tauri::async_runtime::spawn_blocking(move || {
        dunce::canonicalize(&path).map_err(|e| CmdError::io(Path::new(&path), e))
    })
    .await??
    .display()
    .to_string();
    start(&app, state.inner(), dir, state.enqueue(root.clone())?);
    changed(&app);
    Ok(root)
}

/// Queues a refresh of folder `id` (of a file: its folder); for the root, a full scan. The view
/// keeps the old data until `roots-changed` brings the new revision.
#[tauri::command]
pub async fn refresh_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
) -> Result<(), CmdError> {
    let dir = cache_dir(&app)?;
    let target = state.inner().clone();
    let (root, folder) =
        tauri::async_runtime::spawn_blocking(move || target.refresh_target(generation, id))
            .await??;
    start(
        &app,
        state.inner(),
        dir,
        state.enqueue_folder(root, folder)?,
    );
    changed(&app);
    Ok(())
}

/// Moves items of one tree to the trash after checking them against the disk (see
/// `recycle::run_reporting`); refused while a running scan still lists one of them. Reports
/// `trash-progress` meanwhile; `cancel_trash` stops it before the next item.
#[tauri::command]
pub async fn trash(
    app: AppHandle,
    state: State<'_, AppState>,
    generation: u64,
    rev: u64,
    ids: Vec<u32>,
) -> Result<TrashDto, CmdError> {
    state.reset_trash_stop();
    let write = state.begin_write().await?;
    let dir = cache_dir(&app)?;
    let state = state.inner().clone();
    let events = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = recycle::run_reporting(
            &state,
            &dir,
            generation,
            rev,
            &ids,
            sizeatlas_core::can_recycle,
            recycle::move_to_trash,
            |progress: TrashProgressDto| {
                let _ = events.emit("trash-progress", progress);
            },
        );
        drop(write);
        result
    })
    .await?;
    changed(&app);
    result
}

/// Stops the running trash request before its next item; the items moved stay in the trash.
#[tauri::command]
pub async fn cancel_trash(state: State<'_, AppState>) -> Result<(), CmdError> {
    state.stop_trash();
    Ok(())
}

/// Stops the scan of `path`: cancels it if it runs, drops it if it waits. Without a path,
/// cancels the running scan.
#[tauri::command]
pub async fn cancel_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), CmdError> {
    state.cancel_scan(path.as_deref());
    changed(&app);
    Ok(())
}

/// Adds a saved scan as a root, or replaces the open one in place. Does not wait for scans.
#[tauri::command]
pub async fn open_cached(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
) -> Result<Summary, CmdError> {
    let dir = cache_dir(&app)?;
    let state = state.inner().clone();
    let summary =
        tauri::async_runtime::spawn_blocking(move || jobs::open_cached(&state, &dir, &root))
            .await??;
    changed(&app);
    Ok(summary)
}

/// Removes the root with the canonical path `root` from memory and stops its scan; its saved
/// scan stays.
#[tauri::command]
pub async fn close_root(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
) -> Result<(), CmdError> {
    let state = state.inner().clone();
    // Dropping a tree of millions of nodes takes a while: not on the async runtime.
    tauri::async_runtime::spawn_blocking(move || jobs::close_root(&state, &root)).await?;
    changed(&app);
    Ok(())
}

/// Deletes the saved scan of `root` and closes the root. Waits for a saved scan that is being
/// written, so the file cannot come back.
#[tauri::command]
pub async fn forget_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
) -> Result<(), CmdError> {
    let write = state.begin_write().await?;
    let dir = cache_dir(&app)?;
    let state = state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = jobs::forget(&state, &dir, &root);
        drop(write);
        result
    })
    .await?;
    changed(&app);
    result
}
