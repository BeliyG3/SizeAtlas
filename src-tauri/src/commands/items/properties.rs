//! The system Properties dialog of an item (Windows only).
//!
//! `SHObjectProperties` is used instead of `ShellExecuteExW` with the `properties` verb: that
//! one shows the dialog from the calling thread's own machinery, which must stay alive and pump
//! messages until the dialog is up, or the dialog never appears. `SHObjectProperties` hands the
//! dialog to the shell, which keeps it on a thread of its own under a process reference, and
//! returns at once. It is called on the main thread, which has the message loop and COM already.

use std::path::PathBuf;

use tauri::Window;

use crate::error::CmdError;

#[cfg(windows)]
pub async fn show(window: &Window, path: PathBuf) -> Result<(), CmdError> {
    let hwnd = window.hwnd().map_err(CmdError::from)?.0 as isize;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let target = path.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(sys::show(hwnd, &target));
        })
        .map_err(CmdError::from)?;
    match rx.await {
        Ok(true) => Ok(()),
        _ => Err(super::io(&path, "the Properties dialog did not open")),
    }
}

#[cfg(not(windows))]
pub async fn show(_window: &Window, path: PathBuf) -> Result<(), CmdError> {
    Err(super::io(&path, "Properties are shown on Windows only"))
}

#[cfg(windows)]
mod sys {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::null;

    use windows_sys::Win32::UI::Shell::{SHOP_FILEPATH, SHObjectProperties};

    /// Opens the dialog of `path`, owned by the window `hwnd`; false if the shell refused.
    pub fn show(hwnd: isize, path: &Path) -> bool {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        // SAFETY: `hwnd` is this app's live window and `wide` is a NUL-terminated string that
        // outlives the call; the property page may be null (the default one).
        unsafe {
            SHObjectProperties(
                hwnd as *mut c_void,
                SHOP_FILEPATH as u32,
                wide.as_ptr(),
                null(),
            ) != 0
        }
    }
}
