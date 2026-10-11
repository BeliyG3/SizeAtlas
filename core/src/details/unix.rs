//! Unix: permission string and the owner's user name.

use std::collections::HashMap;
use std::ffi::CStr;
use std::fs::Metadata;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::sync::{Mutex, OnceLock, PoisonError};

/// Largest buffer offered to `getpwuid_r`; real entries need well under 4 KiB.
const MAX_PASSWD_BUFFER: usize = 1 << 20;

pub fn attributes(meta: &Metadata) -> String {
    mode_string(meta.mode())
}

/// `ls -l` style mode: file type, then rwx for owner, group and others.
fn mode_string(mode: u32) -> String {
    let kind = match mode & 0o170_000 {
        0o040_000 => 'd',
        0o120_000 => 'l',
        0o020_000 => 'c',
        0o060_000 => 'b',
        0o010_000 => 'p',
        0o140_000 => 's',
        _ => '-',
    };
    let mut out = String::with_capacity(10);
    out.push(kind);
    for (shift, special, letter) in [(6, 0o4000, 's'), (3, 0o2000, 's'), (0, 0o1000, 't')] {
        let bits = (mode >> shift) & 0o7;
        out.push(if bits & 0o4 != 0 { 'r' } else { '-' });
        out.push(if bits & 0o2 != 0 { 'w' } else { '-' });
        out.push(match (mode & special != 0, bits & 0o1 != 0) {
            (true, true) => letter,
            (true, false) => letter.to_ascii_uppercase(),
            (false, true) => 'x',
            (false, false) => '-',
        });
    }
    out
}

/// User name of the owner, or the uid if the system does not know it. Remembered per uid:
/// directory services (LDAP, NIS) can be slow.
pub fn owner(_path: &Path, meta: &Metadata) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<u32, String>>> = OnceLock::new();
    let uid = meta.uid();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(name) = cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&uid)
    {
        return Some(name.clone());
    }
    let name = user_name(uid).unwrap_or_else(|| uid.to_string());
    cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(uid, name.clone());
    Some(name)
}

fn user_name(uid: u32) -> Option<String> {
    let mut buf = vec![libc::c_char::default(); 1024];
    loop {
        // SAFETY: an all-zero passwd is a valid value to be overwritten.
        let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
        let mut result: *mut libc::passwd = std::ptr::null_mut();
        // SAFETY: every pointer is valid and `buf.len()` is the real buffer length.
        let rc =
            unsafe { libc::getpwuid_r(uid, &mut entry, buf.as_mut_ptr(), buf.len(), &mut result) };
        if rc == libc::ERANGE && buf.len() < MAX_PASSWD_BUFFER {
            buf.resize(buf.len() * 2, 0);
            continue;
        }
        if rc != 0 || result.is_null() || entry.pw_name.is_null() {
            return None;
        }
        // SAFETY: on success a non-null `pw_name` points to a NUL-terminated string inside `buf`.
        return Some(
            unsafe { CStr::from_ptr(entry.pw_name) }
                .to_string_lossy()
                .into_owned(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_string_matches_ls() {
        assert_eq!(mode_string(0o040_755), "drwxr-xr-x");
        assert_eq!(mode_string(0o100_644), "-rw-r--r--");
        assert_eq!(mode_string(0o120_777), "lrwxrwxrwx");
        assert_eq!(mode_string(0o104_755), "-rwsr-xr-x");
        assert_eq!(mode_string(0o102_644), "-rw-r-Sr--");
        assert_eq!(mode_string(0o041_777), "drwxrwxrwt");
    }

    #[test]
    fn owner_falls_back_to_the_uid() {
        let dir = tempfile::tempdir().unwrap();
        let meta = std::fs::symlink_metadata(dir.path()).unwrap();
        let name = owner(dir.path(), &meta).unwrap();
        assert!(!name.is_empty());
        // SAFETY: plain libc call without arguments.
        let me = unsafe { libc::geteuid() };
        assert!(user_name(me).is_none_or(|n| n == name), "{name}");
    }
}
