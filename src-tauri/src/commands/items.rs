//! Commands that act on one item of the tree on disk: open, open with, show, copy its path,
//! properties.
//! Also copying a path the tree no longer has.
//! Paths whose names were not valid Unicode are refused (`LossyName`), see `exact_path`.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State, Window};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::CmdError;
use crate::state::AppState;

mod open_with;
mod properties;

fn io(path: &Path, e: impl ToString) -> CmdError {
    CmdError::Io {
        path: path.display().to_string(),
        os_message: e.to_string(),
    }
}

/// The real path of the item, then `act` on it, off the async threads.
async fn on_path<T: Send + 'static>(
    state: &AppState,
    generation: u64,
    id: u32,
    act: impl FnOnce(&Path) -> Result<T, CmdError> + Send + 'static,
) -> Result<T, CmdError> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = state.exact_path(generation, id)?;
        act(&path)
    })
    .await
    .map_err(CmdError::from)?
}

/// Copies the real paths of `ids` to the clipboard, one per line.
#[tauri::command]
pub async fn copy_paths(
    app: AppHandle,
    state: State<'_, AppState>,
    generation: u64,
    ids: Vec<u32>,
) -> Result<(), CmdError> {
    const LINE_END: &str = if cfg!(windows) { "\r\n" } else { "\n" };
    let state = state.inner().clone();
    let text = tauri::async_runtime::spawn_blocking(move || {
        state.exact_paths(generation, &ids).map(|paths| {
            paths
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(LINE_END)
        })
    })
    .await
    .map_err(CmdError::from)??;
    app.clipboard()
        .write_text(text)
        .map_err(|e| io(Path::new(""), e))
}

/// Copies `text` as it is to the clipboard: the path of a deleted folder of "grew most", which
/// the tree no longer has.
#[tauri::command]
pub async fn copy_text(app: AppHandle, text: String) -> Result<(), CmdError> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| io(Path::new(""), e))
}

/// Shows the item in the file manager.
#[tauri::command]
pub async fn reveal(state: State<'_, AppState>, generation: u64, id: u32) -> Result<(), CmdError> {
    on_path(&state, generation, id, |path| {
        tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| io(path, e))
    })
    .await
}

/// Opens a file with the default program of the system, a folder in the file manager.
#[tauri::command]
pub async fn open_item(
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
) -> Result<(), CmdError> {
    on_path(&state, generation, id, |path| {
        tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| io(path, e))
    })
    .await
}

/// The real path of the item, to scan a folder as a root of its own.
#[tauri::command]
pub async fn item_path(
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
) -> Result<String, CmdError> {
    on_path(&state, generation, id, |path| {
        Ok(path.display().to_string())
    })
    .await
}

/// The Properties dialog of the system for the item. Windows only.
#[tauri::command]
pub async fn show_properties(
    window: Window,
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
) -> Result<(), CmdError> {
    let path: PathBuf = on_path(&state, generation, id, |path| Ok(path.to_path_buf())).await?;
    properties::show(&window, path).await
}

/// The "Open with" dialog of the system for the item. Windows only.
#[tauri::command]
pub async fn open_with(
    window: Window,
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
) -> Result<(), CmdError> {
    let path: PathBuf = on_path(&state, generation, id, |path| Ok(path.to_path_buf())).await?;
    open_with::show(&window, path).await
}
