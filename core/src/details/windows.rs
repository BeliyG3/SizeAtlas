//! Windows: attribute letters and the owner account.

use std::collections::HashMap;
use std::fs::Metadata;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::path::Path;
use std::sync::{Mutex, OnceLock, PoisonError};

use windows_sys::Win32::Foundation::{ERROR_SUCCESS, LocalFree};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, GetNamedSecurityInfoW, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    GetLengthSid, LookupAccountSidW, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    SID_NAME_USE,
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_ARCHIVE, FILE_ATTRIBUTE_COMPRESSED, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_ENCRYPTED, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_NOT_CONTENT_INDEXED,
    FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_READONLY, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_ATTRIBUTE_SPARSE_FILE, FILE_ATTRIBUTE_SYSTEM,
};
use windows_sys::core::PWSTR;

/// Shown letters, in display order.
const LETTERS: [(u32, char); 11] = [
    (FILE_ATTRIBUTE_DIRECTORY, 'D'),
    (FILE_ATTRIBUTE_READONLY, 'R'),
    (FILE_ATTRIBUTE_HIDDEN, 'H'),
    (FILE_ATTRIBUTE_SYSTEM, 'S'),
    (FILE_ATTRIBUTE_ARCHIVE, 'A'),
    (FILE_ATTRIBUTE_COMPRESSED, 'C'),
    (FILE_ATTRIBUTE_ENCRYPTED, 'E'),
    (FILE_ATTRIBUTE_NOT_CONTENT_INDEXED, 'I'),
    (FILE_ATTRIBUTE_OFFLINE, 'O'),
    (FILE_ATTRIBUTE_SPARSE_FILE, 'P'),
    (FILE_ATTRIBUTE_REPARSE_POINT, 'L'),
];

/// Account names are at most 256 characters (UNLEN) plus the NUL; domain names fit as well.
const NAME_CAPACITY: usize = 257;

pub fn attributes(meta: &Metadata) -> String {
    letters(meta.file_attributes())
}

fn letters(bits: u32) -> String {
    LETTERS
        .iter()
        .filter(|(bit, _)| bits & bit != 0)
        .map(|&(_, letter)| letter)
        .collect()
}

/// Owner account of `path`; `None` if its security descriptor cannot be read.
pub fn owner(path: &Path, _meta: &Metadata) -> Option<String> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut sid: PSID = std::ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    // SAFETY: `wide` is NUL-terminated; only the owner is requested, so the unused
    // out-pointers may be null; `sid` and `descriptor` are valid out-pointers.
    let status = unsafe {
        GetNamedSecurityInfoW(
            wide.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut sid,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let name = (!sid.is_null()).then(|| cached_account(sid)).flatten();
    // SAFETY: the descriptor was allocated by GetNamedSecurityInfoW; `sid` points into it
    // and is not used after this.
    unsafe { LocalFree(descriptor) };
    name
}

/// Account name of a SID, remembered per SID: a lookup can take seconds for domain
/// accounts, and every file of a folder usually has the same owner.
fn cached_account(sid: PSID) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<Vec<u8>, Option<String>>>> = OnceLock::new();
    // SAFETY: `sid` is a valid SID taken from a security descriptor.
    let len = unsafe { GetLengthSid(sid) } as usize;
    // SAFETY: a valid SID is `len` bytes long.
    let key = unsafe { std::slice::from_raw_parts(sid.cast::<u8>(), len) }.to_vec();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(hit) = cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&key)
    {
        return hit.clone();
    }
    // The lock is not held during the lookup; two threads may look up the same SID once each.
    let name = account_name(sid).or_else(|| sid_string(sid));
    cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(key, name.clone());
    name
}

fn account_name(sid: PSID) -> Option<String> {
    let mut name = [0u16; NAME_CAPACITY];
    let mut domain = [0u16; NAME_CAPACITY];
    let mut name_len = NAME_CAPACITY as u32;
    let mut domain_len = NAME_CAPACITY as u32;
    let mut kind: SID_NAME_USE = 0;
    // SAFETY: the buffers have the lengths passed; `sid` is valid.
    let ok = unsafe {
        LookupAccountSidW(
            std::ptr::null(),
            sid,
            name.as_mut_ptr(),
            &mut name_len,
            domain.as_mut_ptr(),
            &mut domain_len,
            &mut kind,
        )
    };
    if ok == 0 {
        return None;
    }
    // On success the lengths exclude the terminating NUL.
    let name = String::from_utf16_lossy(&name[..name_len as usize]);
    let domain = String::from_utf16_lossy(&domain[..domain_len as usize]);
    Some(if domain.is_empty() {
        name
    } else {
        format!("{domain}\\{name}")
    })
}

/// `S-1-5-…` form of a SID whose account is unknown (deleted, or from another domain).
fn sid_string(sid: PSID) -> Option<String> {
    let mut text: PWSTR = std::ptr::null_mut();
    // SAFETY: `sid` is valid; on success `text` is a NUL-terminated string from LocalAlloc.
    if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 {
        return None;
    }
    // SAFETY: `text` is NUL-terminated, so every index before the NUL is in bounds.
    let len = (0..).take_while(|&i| unsafe { *text.add(i) } != 0).count();
    // SAFETY: `len` characters before the NUL are initialized.
    let value = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, len) });
    // SAFETY: `text` was allocated by ConvertSidToStringSidW and is not used after this.
    unsafe { LocalFree(text.cast()) };
    Some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_follow_the_display_order() {
        assert_eq!(letters(0), "");
        assert_eq!(letters(0x400 | 0x20 | 0x10), "DAL");
        assert_eq!(letters(0x1 | 0x2 | 0x4), "RHS");
        assert_eq!(letters(0x800 | 0x4000 | 0x2000 | 0x1000 | 0x200), "CEIOP");
    }

    #[test]
    fn owner_of_a_missing_path_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let meta = std::fs::symlink_metadata(dir.path()).unwrap();
        assert_eq!(owner(&dir.path().join("missing"), &meta), None);
    }
}
