//! The system "Open with" dialog of a file (Windows only).
//!
//! `SHOpenWithDialog` is modal: it runs its own message loop and returns only when the user has
//! chosen a program or cancelled. So it runs on a dedicated thread, not on the main thread (that
//! would freeze the app) and not on a pool thread (it may already have another COM apartment, and
//! the dialog needs a single-threaded one). The thread joins COM as an STA, shows the dialog and
//! leaves COM again.
//!
//! The owner window lives on another thread, so while the dialog is open the main window is
//! disabled and does not repaint in step with it. If the live run hangs, pass a null owner.

use std::path::PathBuf;

use tauri::Window;

use crate::error::CmdError;

#[cfg(windows)]
pub async fn show(window: &Window, path: PathBuf) -> Result<(), CmdError> {
    let hwnd = window.hwnd().map_err(CmdError::from)?.0 as isize;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let target = path.clone();
    std::thread::spawn(move || {
        let _ = tx.send(sys::show(hwnd, &target));
    });
    match rx.await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(message)) => Err(super::io(&path, message)),
        Err(_) => Err(super::io(&path, "the Open with dialog did not open")),
    }
}

#[cfg(not(windows))]
pub async fn show(_window: &Window, path: PathBuf) -> Result<(), CmdError> {
    Err(super::io(&path, "Open with is offered on Windows only"))
}

#[cfg(windows)]
mod sys {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::null;

    use windows_sys::Win32::Foundation::{ERROR_CANCELLED, S_FALSE, S_OK};
    use windows_sys::Win32::System::Com::{
        COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize,
    };
    use windows_sys::Win32::UI::Shell::{
        OAIF_ALLOW_REGISTRATION, OAIF_EXEC, OPENASINFO, SHOpenWithDialog,
    };

    /// `HRESULT_FROM_WIN32(ERROR_CANCELLED)`: the user closed the dialog.
    const CANCELLED: i32 = 0x8007_0000_u32 as i32 | ERROR_CANCELLED as i32;

    /// Shows the dialog of `path`, owned by the window `hwnd`, and waits for it to close.
    /// Cancelling is not an error.
    pub fn show(hwnd: isize, path: &Path) -> Result<(), String> {
        // SAFETY: plain COM calls on this thread; `CoUninitialize` only follows a successful init.
        let init = unsafe { CoInitializeEx(null(), COINIT_APARTMENTTHREADED as u32) };
        if init != S_OK && init != S_FALSE {
            return Err(format!("COM did not start ({init:#x})"));
        }
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        let info = OPENASINFO {
            pcszFile: wide.as_ptr(),
            pcszClass: null(),
            oaifInFlags: OAIF_ALLOW_REGISTRATION | OAIF_EXEC,
        };
        // SAFETY: `hwnd` is this app's live window; `info` and `wide` (NUL-terminated) outlive the
        // call.
        let hr = unsafe { SHOpenWithDialog(hwnd as *mut c_void, &info) };
        // SAFETY: balances the successful `CoInitializeEx` above.
        unsafe { CoUninitialize() };
        if hr >= 0 || hr == CANCELLED {
            Ok(())
        } else {
            Err(format!("the Open with dialog did not open ({hr:#x})"))
        }
    }
}
