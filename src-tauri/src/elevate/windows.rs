//! The Win32 calls behind `elevate`.

use std::ffi::{OsStr, c_void};
use std::io;
use std::iter::once;
use std::os::windows::ffi::OsStrExt;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_CANCELLED, ERROR_NOT_ALL_ASSIGNED, GetLastError, HANDLE, LUID,
};
use windows_sys::Win32::Security::{
    AdjustTokenPrivileges, GetTokenInformation, LUID_AND_ATTRIBUTES, LookupPrivilegeValueW,
    SE_BACKUP_NAME, SE_PRIVILEGE_ENABLED, TOKEN_ADJUST_PRIVILEGES, TOKEN_ELEVATION,
    TOKEN_PRIVILEGES, TOKEN_QUERY, TokenElevation,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_SYNCHRONIZE, WaitForSingleObject,
};
use windows_sys::Win32::UI::Shell::{
    SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW, ShellExecuteExW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use crate::error::CmdError;

fn wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(once(0)).collect()
}

pub fn is_elevated() -> bool {
    let mut token: HANDLE = null_mut();
    // SAFETY: the pseudo handle of the current process needs no closing; `token` is
    // closed below once it was opened.
    unsafe {
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            (&raw mut elevation).cast::<c_void>(),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        );
        CloseHandle(token);
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

pub fn wait_for_exit(pid: u32, timeout_ms: u32) {
    // SAFETY: the handle is closed once it was opened; a null handle means no process.
    unsafe {
        let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if process.is_null() {
            return;
        }
        WaitForSingleObject(process, timeout_ms);
        CloseHandle(process);
    }
}

/// Starts the current executable with the `runas` verb; blocks while the UAC prompt shows.
pub fn run_as(params: &str) -> Result<(), CmdError> {
    let exe = std::env::current_exe().map_err(|e| CmdError::Io {
        path: String::new(),
        os_message: e.to_string(),
    })?;
    let file = wide(exe.as_os_str());
    let verb = wide(OsStr::new("runas"));
    let params = wide(OsStr::new(params));
    // SAFETY: all-zero is a valid SHELLEXECUTEINFOW (null pointers, no flags).
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = size_of::<SHELLEXECUTEINFOW>() as u32;
    // No error box of the shell: the UI reports the failure.
    info.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.nShow = SW_SHOWNORMAL;
    // SAFETY: the strings outlive the call and are NUL-terminated.
    if unsafe { ShellExecuteExW(&mut info) } != 0 {
        return Ok(());
    }
    let err = io::Error::last_os_error();
    if err.raw_os_error() == Some(ERROR_CANCELLED as i32) {
        return Err(CmdError::Cancelled);
    }
    Err(CmdError::Io {
        path: exe.display().to_string(),
        os_message: err.to_string(),
    })
}

/// Whether `AdjustTokenPrivileges` enabled the privilege: it also succeeds when the token
/// lacks it, and then sets `ERROR_NOT_ALL_ASSIGNED`.
pub fn adjusted(ok: i32, last_error: u32) -> bool {
    ok != 0 && last_error != ERROR_NOT_ALL_ASSIGNED
}

/// Enables `SeBackupPrivilege` in the process token; nothing else (no restore privilege).
pub fn enable_backup_privilege() -> bool {
    let mut token: HANDLE = null_mut();
    // SAFETY: `token` is closed once it was opened; the structs live across the calls.
    unsafe {
        let access = TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY;
        if OpenProcessToken(GetCurrentProcess(), access, &mut token) == 0 {
            return false;
        }
        let mut luid = LUID {
            LowPart: 0,
            HighPart: 0,
        };
        let mut enabled = false;
        if LookupPrivilegeValueW(null(), SE_BACKUP_NAME, &mut luid) != 0 {
            let privileges = TOKEN_PRIVILEGES {
                PrivilegeCount: 1,
                Privileges: [LUID_AND_ATTRIBUTES {
                    Luid: luid,
                    Attributes: SE_PRIVILEGE_ENABLED,
                }],
            };
            let ok = AdjustTokenPrivileges(token, 0, &privileges, 0, null_mut(), null_mut());
            enabled = adjusted(ok, GetLastError());
        }
        CloseHandle(token);
        enabled
    }
}
