//! Thin Tauri wrappers for reads; logic lives in `state`. Commands that change the open roots
//! are in `roots`, the removals in `trash`, those that act on one item on disk in `items`, the
//! CSV export in `export`, the duplicate search in `duplicates`.

use sizeatlas_core::tree::{ListKind, ListOrder};
use tauri::{AppHandle, State, Window};

use crate::details;
use crate::dto::{
    ChildrenDto, CrumbDto, DetailsDto, ListDto, Summary, TrashPreviewDto, TypeStatsDto,
};
use crate::elevate::{self, StartupRescans};
use crate::error::CmdError;
use crate::state::AppState;

pub mod duplicates;
pub mod export;
pub mod items;
pub mod roots;
pub mod trash;

#[tauri::command]
pub async fn get_summary(state: State<'_, AppState>, generation: u64) -> Result<Summary, CmdError> {
    state.summary(generation)
}

#[tauri::command]
pub async fn get_children(
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
    offset: u32,
    limit: u32,
    order: ListOrder,
) -> Result<ChildrenDto, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.children(generation, id, offset, limit, order)
    })
    .await
    .map_err(CmdError::from)?
}

#[tauri::command]
pub async fn get_position(
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
    order: ListOrder,
) -> Result<Option<u32>, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.position(generation, id, order))
        .await
        .map_err(CmdError::from)?
}

/// Created/accessed times, attributes and owner of up to 500 rows, read from disk.
#[tauri::command]
pub async fn get_details(
    state: State<'_, AppState>,
    generation: u64,
    ids: Vec<u32>,
) -> Result<DetailsDto, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<DetailsDto, CmdError> {
        let paths = state.detail_paths(generation, &ids)?;
        Ok(details::read_all(generation, paths))
    })
    .await
    .map_err(CmdError::from)?
}

#[tauri::command]
pub async fn get_crumbs(
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
    order: Option<ListOrder>,
) -> Result<Vec<CrumbDto>, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.crumbs(generation, id, order))
        .await
        .map_err(CmdError::from)?
}

#[tauri::command]
pub async fn get_type_stats(
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
) -> Result<TypeStatsDto, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.type_stats(generation, id))
        .await
        .map_err(CmdError::from)?
}

/// Up to `limit` (at most 1000) items below `id`, in the order of `kind`. `query` only matters
/// for `ListKind::Search`.
#[tauri::command]
pub async fn get_list(
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
    kind: ListKind,
    limit: u32,
    query: Option<String>,
) -> Result<ListDto, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.list(generation, id, kind, limit, query.as_deref())
    })
    .await
    .map_err(CmdError::from)?
}

/// `id`, or its nearest live ancestor if a change removed it.
#[tauri::command]
pub async fn get_live_ancestor(
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
) -> Result<u32, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.live_ancestor(generation, id))
        .await
        .map_err(CmdError::from)?
}

/// What `trash` would move: the items without those inside another one, their size and the
/// first paths.
#[tauri::command]
pub async fn trash_preview(
    state: State<'_, AppState>,
    generation: u64,
    rev: u64,
    ids: Vec<u32>,
) -> Result<TrashPreviewDto, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.trash_preview(generation, rev, &ids))
        .await
        .map_err(CmdError::from)?
}

/// Whether a running scan keeps one of `ids` from going to the trash now (see
/// `AppState::trash_refused`): the menus disable the item and say why.
#[tauri::command]
pub async fn trash_refused(
    state: State<'_, AppState>,
    generation: u64,
    rev: u64,
    ids: Vec<u32>,
) -> Result<bool, CmdError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.trash_refused(generation, rev, &ids))
        .await
        .map_err(CmdError::from)?
}

/// Raw bytes: the UI receives an `ArrayBuffer` (format in `sizeatlas_core::treemap`).
#[tauri::command]
pub async fn get_treemap(
    state: State<'_, AppState>,
    generation: u64,
    id: u32,
    width: f32,
    height: f32,
) -> Result<tauri::ipc::Response, CmdError> {
    let state = state.inner().clone();
    let bytes =
        tauri::async_runtime::spawn_blocking(move || state.treemap(generation, id, width, height))
            .await
            .map_err(CmdError::from)??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Raw bytes of the whole root's island map (format in `sizeatlas_core::city`).
#[tauri::command]
pub async fn get_city(
    app: AppHandle,
    state: State<'_, AppState>,
    generation: u64,
) -> Result<tauri::ipc::Response, CmdError> {
    let state = state.inner().clone();
    let dir = roots::cache_dir(&app)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || state.city(generation, &dir))
        .await
        .map_err(CmdError::from)??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn is_elevated() -> bool {
    elevate::is_elevated()
}

#[tauri::command]
pub fn has_full_disk_access() -> bool {
    elevate::has_full_disk_access()
}

/// Starts the app again as administrator to scan `roots` again, then closes this window the
/// way its close button does. Windows only.
#[tauri::command]
pub async fn restart_elevated(window: Window, roots: Vec<String>) -> Result<(), CmdError> {
    tauri::async_runtime::spawn_blocking(move || elevate::restart_elevated(&roots))
        .await
        .map_err(CmdError::from)??;
    // The new instance runs already: a window that does not close is no failed restart.
    if let Err(e) = window.close() {
        eprintln!("SizeAtlas: closing the window after the restart failed: {e}");
    }
    Ok(())
}

/// The roots named with `--rescan` at start; empty after the first call.
#[tauri::command]
pub fn take_startup_rescans(rescans: State<'_, StartupRescans>) -> Vec<String> {
    rescans.take()
}

/// The Full Disk Access list in the macOS privacy settings.
#[tauri::command]
pub async fn open_privacy_settings() -> Result<(), CmdError> {
    const URL: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
    tauri_plugin_opener::open_url(URL, None::<&str>).map_err(|e| CmdError::Io {
        path: URL.to_owned(),
        os_message: e.to_string(),
    })
}

/// The project page on GitHub; `open_url` opens nothing else.
const REPOSITORY: &str = "https://github.com/BeliyG3/SizeAtlas";

/// The project page itself or a plain path under it, such as a release page.
fn is_repository_url(url: &str) -> bool {
    match url.strip_prefix(REPOSITORY) {
        Some("") => true,
        Some(rest) => {
            rest.starts_with('/')
                && !rest.contains("..")
                && rest
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c))
        }
        None => false,
    }
}

/// Opens a page of the project on GitHub in the browser; any other URL is refused.
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), CmdError> {
    if !is_repository_url(&url) {
        return Err(CmdError::Io {
            path: url,
            os_message: "not a page of the SizeAtlas repository".to_owned(),
        });
    }
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| CmdError::Io {
        path: url,
        os_message: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::is_repository_url;

    #[test]
    fn opens_only_pages_of_the_repository() {
        assert!(is_repository_url("https://github.com/BeliyG3/SizeAtlas"));
        assert!(is_repository_url(
            "https://github.com/BeliyG3/SizeAtlas/releases/tag/v2026.11.1"
        ));
        for url in [
            "https://github.com/BeliyG3/SizeAtlasX",
            "https://github.com/BeliyG3/SizeAtlas.evil.com",
            "https://github.com/BeliyG3/SizeAtlas@evil.com",
            "https://github.com/BeliyG3/SizeAtlas/../../other",
            "https://github.com/BeliyG3/SizeAtlas/?q=1",
            "http://github.com/BeliyG3/SizeAtlas",
            "https://evil.com/https://github.com/BeliyG3/SizeAtlas",
            "file:///C:/Windows",
            "",
        ] {
            assert!(!is_repository_url(url), "{url}");
        }
    }
}
