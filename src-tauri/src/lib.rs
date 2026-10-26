//! SizeAtlas desktop app: wires plugins, state and commands into Tauri.

mod baseline;
mod cleanup;
mod commands;
mod details;
mod dto;
mod elevate;
// pub: some variants are used from M2 on (trash, rescan)
pub mod error;
mod exit;
mod jobs;
mod queue;
mod recycle;
mod sources;
mod state;
mod title_bar;
mod worker;
mod writes;

use exit::ExitDecision;
use state::AppState;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

/// Shows "Saving…" and exits once the saved scan being written is done.
fn exit_after_change(app: &tauri::AppHandle, state: AppState) {
    let _ = app.emit("closing", ());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        state.wait_until_idle().await;
        app.exit(0);
    });
}

pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // Before any window opens: an instance restarted as administrator waits for the old one.
    if let Some(pid) = elevate::parse_wait_pid(args.iter().cloned()) {
        elevate::wait_for_exit(pid);
    }
    // Before any scan.
    if elevate::is_elevated() && !elevate::enable_backup_privilege() {
        eprintln!("SizeAtlas: could not enable the backup privilege; some folders stay unread");
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::default())
        .manage(elevate::StartupRescans::from_args(args))
        .invoke_handler(tauri::generate_handler![
            commands::get_summary,
            commands::get_children,
            commands::get_position,
            commands::get_details,
            commands::get_crumbs,
            commands::get_type_stats,
            commands::get_list,
            commands::get_live_ancestor,
            commands::trash_preview,
            commands::trash_refused,
            commands::get_treemap,
            commands::export::export_table,
            commands::items::copy_paths,
            commands::items::copy_text,
            commands::items::reveal,
            commands::items::open_item,
            commands::items::item_path,
            commands::items::show_properties,
            commands::is_elevated,
            commands::has_full_disk_access,
            commands::restart_elevated,
            commands::take_startup_rescans,
            commands::open_privacy_settings,
            commands::open_url,
            title_bar::set_title_bar,
            commands::roots::list_sources,
            commands::roots::list_roots,
            commands::roots::scan,
            commands::roots::refresh_folder,
            commands::trash::trash,
            commands::trash::delete_for_good,
            commands::trash::cancel_trash,
            commands::roots::cancel_scan,
            commands::roots::open_cached,
            commands::roots::close_root,
            commands::roots::forget_scan,
        ])
        .setup(|app| {
            let title = title_bar::window_title(
                &app.package_info().version.to_string(),
                cfg!(debug_assertions),
            );
            if let Some(window) = app.get_webview_window("main")
                && let Err(e) = window.set_title(&title)
            {
                eprintln!("SizeAtlas: could not set the window title: {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>().inner().clone();
                match state.on_exit_request() {
                    ExitDecision::Allow => {}
                    ExitDecision::Prevent => api.prevent_close(),
                    ExitDecision::PreventAndWait => {
                        api.prevent_close();
                        exit_after_change(window.app_handle(), state);
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building SizeAtlas");

    app.run(|app, event| match event {
        // `code` is Some for our own `app.exit(0)`.
        RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            let state = app.state::<AppState>().inner().clone();
            match state.on_exit_request() {
                ExitDecision::Allow => {}
                ExitDecision::Prevent => api.prevent_exit(),
                ExitDecision::PreventAndWait => {
                    api.prevent_exit();
                    exit_after_change(app, state);
                }
            }
        }
        RunEvent::Exit => app.state::<AppState>().block_until_idle(),
        _ => {}
    });
}
