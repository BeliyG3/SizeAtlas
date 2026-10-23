//! Whether Windows has file operations or updates waiting for a restart.

use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::System::Registry::{
    HKEY, HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_ANY, RegCloseKey, RegGetValueW, RegOpenKeyExW,
};

const SESSION_MANAGER: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager";
/// Keys that exist only while servicing or Windows Update waits for a restart.
const REBOOT_KEYS: [&str; 2] = [
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired",
];

/// Files are to be moved or deleted at the next restart (`PendingFileRenameOperations`), or
/// servicing or Windows Update waits for one. A key or value that exists but cannot be read
/// counts as pending: the answer hides `%SystemRoot%\Temp`, so it fails closed.
pub fn reboot_pending() -> bool {
    let key = wide(SESSION_MANAGER);
    let value = wide("PendingFileRenameOperations");
    // SAFETY: both names are NUL-terminated; with no buffer and no size the call only says
    // whether the value exists.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_ANY,
            null_mut(),
            null_mut(),
            null_mut(),
        )
    };
    exists(status)
        || REBOOT_KEYS.iter().any(|key| {
            let key = wide(key);
            let mut handle: HKEY = null_mut();
            // SAFETY: `key` is NUL-terminated and `handle` is a valid out-pointer.
            let status = unsafe {
                RegOpenKeyExW(HKEY_LOCAL_MACHINE, key.as_ptr(), 0, KEY_READ, &mut handle)
            };
            if status == ERROR_SUCCESS {
                // SAFETY: `handle` was opened by the successful call above and is closed once.
                unsafe { RegCloseKey(handle) };
            }
            exists(status)
        })
}

/// Whether a registry status says the key or value is there (or may be: any other error).
fn exists(status: u32) -> bool {
    !matches!(status, ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_missing_key_or_value_is_no_pending_restart() {
        use windows_sys::Win32::Foundation::ERROR_ACCESS_DENIED;
        assert!(exists(ERROR_SUCCESS));
        assert!(exists(ERROR_ACCESS_DENIED), "fails closed");
        assert!(!exists(ERROR_FILE_NOT_FOUND));
        assert!(!exists(ERROR_PATH_NOT_FOUND));
    }

    #[test]
    fn the_system_answers_without_failing() {
        // Read only; either answer is valid on a real machine.
        let _ = reboot_pending();
    }
}
