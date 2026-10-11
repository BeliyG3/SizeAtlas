//! Mapped network drives (Windows). `sysinfo` lists fixed and removable volumes only.

use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use windows_sys::Win32::NetworkManagement::WNet::WNetGetConnectionW;
use windows_sys::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives,
};

use crate::dto::DiskDto;

/// `DRIVE_REMOTE` of `GetDriveTypeW`.
const DRIVE_REMOTE: u32 = 4;
/// How long all the drives together get to report their space. A share that is down can make
/// `GetDiskFreeSpaceExW` block for much longer; such a drive is listed as disconnected.
const SPACE_TIMEOUT: Duration = Duration::from_secs(2);

/// Total and available bytes of a drive.
type Space = (u64, u64);

/// The mapped network drives, disconnected ones included. Blocks for at most `SPACE_TIMEOUT`
/// (plus the quick calls that name the drives), so it belongs on a blocking thread.
pub fn list() -> Vec<DiskDto> {
    let mask = unsafe { GetLogicalDrives() };
    let queries: Vec<_> = (0..26u8)
        .filter(|bit| mask >> bit & 1 == 1)
        .map(|bit| format!("{}:\\", char::from(b'A' + bit)))
        .filter(|mount| is_remote(mount))
        .map(|mount| {
            let remote = remote_name(&mount[..2]);
            let rx = query_space(mount.clone());
            (mount, remote, rx)
        })
        .collect();
    // One shared deadline: several dead shares cost 2 s together, not each.
    let deadline = Instant::now() + SPACE_TIMEOUT;
    queries
        .into_iter()
        .map(|(mount, remote, rx)| {
            let wait = deadline.saturating_duration_since(Instant::now());
            let space = rx.recv_timeout(wait).ok().flatten();
            disk(mount, remote.as_deref(), space)
        })
        .collect()
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

fn is_remote(mount: &str) -> bool {
    unsafe { GetDriveTypeW(wide(mount).as_ptr()) == DRIVE_REMOTE }
}

/// The UNC path behind `R:`; `None` if Windows does not know it.
fn remote_name(local: &str) -> Option<String> {
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let status = unsafe { WNetGetConnectionW(wide(local).as_ptr(), buf.as_mut_ptr(), &mut len) };
    let end = buf.iter().position(|&c| c == 0)?;
    (status == 0).then(|| String::from_utf16_lossy(&buf[..end]))
}

/// Asks for the space on its own thread, which is left behind if the share never answers.
fn query_space(mount: String) -> mpsc::Receiver<Option<Space>> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let (mut available, mut total, mut free) = (0u64, 0u64, 0u64);
        let ok = unsafe {
            GetDiskFreeSpaceExW(wide(&mount).as_ptr(), &mut available, &mut total, &mut free)
        };
        let _ = tx.send((ok != 0).then_some((total, available)));
    });
    rx
}

/// The last part of a UNC path: `share` for `\\server\share`. The whole path if it has none.
fn share_name(unc: &str) -> &str {
    match unc.trim_end_matches('\\').rsplit('\\').next() {
        Some(last) if !last.is_empty() => last,
        _ => unc,
    }
}

/// A network drive as listed; no `space` means it is disconnected.
fn disk(mount: String, remote: Option<&str>, space: Option<Space>) -> DiskDto {
    let (total, available) = space.unwrap_or_default();
    DiskDto {
        name: remote.map(share_name).unwrap_or_default().to_owned(),
        mount,
        total,
        available,
        removable: false,
        network: true,
        connected: space.is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_a_drive_by_its_share() {
        assert_eq!(share_name(r"\\server\share"), "share");
        assert_eq!(share_name(r"\\server\media\films\"), "films");
        assert_eq!(share_name(r"\\server"), "server");
        assert_eq!(share_name(""), "");
    }

    #[test]
    fn lists_a_reachable_share_with_its_space() {
        let d = disk(r"R:\".into(), Some(r"\\server\share"), Some((100, 40)));
        assert_eq!((d.name.as_str(), d.mount.as_str()), ("share", r"R:\"));
        assert_eq!((d.total, d.available), (100, 40));
        assert!(d.network && d.connected && !d.removable);
    }

    #[test]
    fn lists_an_unreachable_share_without_sizes() {
        let d = disk(r"R:\".into(), Some(r"\\server\share"), None);
        assert!(d.network && !d.connected);
        assert_eq!((d.total, d.available), (0, 0));
        assert_eq!(disk(r"S:\".into(), None, None).name, "");
    }
}
