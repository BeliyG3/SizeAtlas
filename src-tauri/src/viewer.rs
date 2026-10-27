//! The picture viewer: a second window of the same page (`index.html?viewer`). Only the main
//! window runs the exit; closing the viewer just closes it.

use tauri::window::Color;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::error::CmdError;
use crate::state::AppState;

pub const VIEWER: &str = "viewer";

/// Whether closing the window with this label goes through the exit rules.
pub fn runs_exit(label: &str) -> bool {
    label == "main"
}

/// Brings an open viewer to the front.
fn raise(window: &WebviewWindow) -> Result<(), CmdError> {
    window.show()?;
    window.unminimize()?;
    window.set_focus()?;
    Ok(())
}

/// Opens the viewer window, or raises the one already open. `title` is the window title;
/// `dark` picks the background shown before the page paints.
#[tauri::command]
pub async fn open_viewer(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    dark: bool,
) -> Result<(), CmdError> {
    // No new window once the exit started.
    if state.closing() {
        return Err(CmdError::Busy);
    }
    if let Some(window) = app.get_webview_window(VIEWER) {
        return raise(&window);
    }
    // `--bg` of each theme in theme.css.
    let background = if dark {
        Color(0x18, 0x18, 0x18, 255)
    } else {
        Color(0xf5, 0xf6, 0xf8, 255)
    };
    let built =
        WebviewWindowBuilder::new(&app, VIEWER, WebviewUrl::App("index.html?viewer".into()))
            .title(title)
            .inner_size(900.0, 700.0)
            .min_inner_size(320.0, 240.0)
            .background_color(background)
            .build();
    match built {
        Ok(_) => Ok(()),
        // A double click: the other call built it first.
        Err(e) => match app.get_webview_window(VIEWER) {
            Some(window) => raise(&window),
            None => Err(e.into()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_main_window_runs_the_exit() {
        assert!(runs_exit("main"));
        assert!(!runs_exit(VIEWER));
        assert!(!runs_exit(""));
    }
}
