//! Read-only registry reads shared by the Recycle Bin and restart checks. A key or value counts
//! as missing only when the system says so; any other error says nothing about the setting.

use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::System::Registry::{
    HKEY, KEY_READ, RRF_RT_ANY, RRF_RT_REG_DWORD, RegCloseKey, RegGetValueW, RegOpenKeyExW,
};

/// The DWORD `value` of `key` in `hive`: `Ok(None)` if it is not set, `Err` if it cannot be read.
pub(super) fn dword(hive: HKEY, key: &str, value: &str) -> Result<Option<u32>, ()> {
    let (key, value) = (wide(key), wide(value));
    let mut data = 0u32;
    let mut size = size_of::<u32>() as u32;
    // SAFETY: both names are NUL-terminated; `data` is a valid out-buffer of `size` bytes.
    let status = unsafe {
        RegGetValueW(
            hive,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            null_mut(),
            (&raw mut data).cast(),
            &mut size,
        )
    };
    read_status(status, data)
}

/// Whether `value` of `key` exists, of any type. One that cannot be read counts as existing.
pub(super) fn value_exists(hive: HKEY, key: &str, value: &str) -> bool {
    let (key, value) = (wide(key), wide(value));
    // SAFETY: both names are NUL-terminated; with no buffer and no size the call only says
    // whether the value exists.
    let status = unsafe {
        RegGetValueW(
            hive,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_ANY,
            null_mut(),
            null_mut(),
            null_mut(),
        )
    };
    present(status)
}

/// Whether `key` exists. One that cannot be opened counts as existing.
pub(super) fn key_exists(hive: HKEY, key: &str) -> bool {
    let key = wide(key);
    let mut handle: HKEY = null_mut();
    // SAFETY: `key` is NUL-terminated and `handle` is a valid out-pointer.
    let status = unsafe { RegOpenKeyExW(hive, key.as_ptr(), 0, KEY_READ, &mut handle) };
    if status == ERROR_SUCCESS {
        // SAFETY: `handle` was opened by the successful call above and is closed once.
        unsafe { RegCloseKey(handle) };
    }
    present(status)
}

/// The result of a registry read: the value, no value (the key or the value does not exist), or
/// an error that says nothing about the setting.
fn read_status(status: u32, data: u32) -> Result<Option<u32>, ()> {
    match status {
        ERROR_SUCCESS => Ok(Some(data)),
        ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(None),
        _ => Err(()),
    }
}

fn present(status: u32) -> bool {
    read_status(status, 0) != Ok(None)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_MORE_DATA};

    #[test]
    fn only_a_missing_setting_counts_as_not_set() {
        const ERROR_UNSUPPORTED_TYPE: u32 = 1630;
        assert_eq!(read_status(ERROR_SUCCESS, 7), Ok(Some(7)));
        assert_eq!(read_status(ERROR_SUCCESS, 0), Ok(Some(0)));
        assert_eq!(read_status(ERROR_FILE_NOT_FOUND, 0), Ok(None));
        assert_eq!(read_status(ERROR_PATH_NOT_FOUND, 0), Ok(None));
        for status in [
            ERROR_ACCESS_DENIED,
            ERROR_MORE_DATA,
            ERROR_UNSUPPORTED_TYPE,
            u32::MAX,
        ] {
            assert_eq!(read_status(status, 7), Err(()), "status {status}");
        }
    }

    #[test]
    fn an_unreadable_key_or_value_counts_as_present() {
        assert!(present(ERROR_SUCCESS));
        assert!(present(ERROR_ACCESS_DENIED), "fails closed");
        assert!(!present(ERROR_FILE_NOT_FOUND));
        assert!(!present(ERROR_PATH_NOT_FOUND));
    }
}
