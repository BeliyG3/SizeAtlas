//! Whether an item would go to the Recycle Bin or be deleted for good.

use std::path::Path;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::S_OK;
use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetVolumeNameForVolumeMountPointW, GetVolumePathNameW,
};
use windows_sys::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RegGetValueW,
};

use windows_sys::Win32::UI::Shell::{SHQUERYRBINFO, SHQueryRecycleBinW};

use super::wide_nul;
use crate::platform::BinSpace;

/// `DRIVE_FIXED` of `GetDriveTypeW` (windows-sys has it under another feature).
const DRIVE_FIXED: u32 = 3;
/// Recycle Bin settings of the current user, one key per volume.
const BIT_BUCKET: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\";
/// Explorer policies, of the user and of the machine.
const EXPLORER_POLICIES: &str = r"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer";

/// Whether an item of `item_size` bytes goes to the Recycle Bin rather than being deleted for
/// good: only on a fixed drive whose volume is known (`has_guid`: its bin settings can be read),
/// when no policy deletes files at once (`no_recycle_policy`), its bin is not turned off
/// (`nuke_on_delete`) and its [`effective_capacity`] is known and not smaller than the item.
pub fn trash_allowed(
    drive_type: u32,
    has_guid: bool,
    no_recycle_policy: bool,
    nuke_on_delete: bool,
    capacity: Option<u64>,
    item_size: u64,
) -> bool {
    drive_type == DRIVE_FIXED
        && has_guid
        && !no_recycle_policy
        && !nuke_on_delete
        && capacity.is_some_and(|capacity| item_size <= capacity)
}

/// The size limit of a bin, for every check of the trash: `MaxCapacity` when set, else the
/// Windows default for a volume of `volume_size` bytes; `None` when neither is known.
///
/// ponytail: the default of a bin never configured is taken as 5 % of the volume. Windows gives
/// at least that, so this refuses some items the real bin would take, never the other way.
fn effective_capacity(max_capacity: Option<u64>, volume_size: Option<u64>) -> Option<u64> {
    max_capacity.or(volume_size.map(|size| size / 20))
}

/// The bin of the volume of `path`: its [`effective_capacity`] and the bytes it holds (for
/// "the bin holds {free} more"). `None` when either cannot be read.
pub fn bin_space(path: &Path) -> Option<BinSpace> {
    let root = volume_root(path)?;
    let guid = volume_guid(&root)?;
    let capacity = effective_capacity(max_capacity(&guid).ok()?, volume_size(&root))?;
    let mut info = SHQUERYRBINFO {
        cbSize: size_of::<SHQUERYRBINFO>() as u32,
        i64Size: 0,
        i64NumItems: 0,
    };
    // SAFETY: `root` is NUL-terminated and `info` is a valid out-buffer whose size it states.
    if unsafe { SHQueryRecycleBinW(root.as_ptr(), &mut info) } != S_OK {
        return None;
    }
    Some(BinSpace {
        capacity,
        used: u64::try_from(info.i64Size).ok()?,
    })
}

/// `trash_allowed` for an item at `path` of `size` bytes, read from the system: the drive type,
/// the `NoRecycleFiles` policy and the Recycle Bin settings of its volume (a setting not set:
/// the bin is on and its size limit is the volume default). A setting that cannot be read (access
/// denied, another type) refuses the item: it may be the one that turns the bin off.
pub fn can_recycle(path: &Path, size: u64) -> bool {
    let Some(root) = volume_root(path) else {
        return false;
    };
    // A path on a `subst` drive arrives already resolved to its real drive: the app keeps
    // canonical paths.
    // SAFETY: `root` is NUL-terminated.
    let drive_type = unsafe { GetDriveTypeW(root.as_ptr()) };
    let guid = volume_guid(&root);
    let read = || -> Result<_, ()> {
        let Some(guid) = &guid else {
            // Refused by `trash_allowed` below, whatever the settings say.
            return Ok((false, None, false));
        };
        let nuke =
            dword(HKEY_CURRENT_USER, &bin_key(guid), "NukeOnDelete")?.is_some_and(|v| v != 0);
        let max_capacity = max_capacity(guid)?;
        let mut policy = false;
        for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            policy |= dword(hive, EXPLORER_POLICIES, "NoRecycleFiles")?.is_some_and(|v| v != 0);
        }
        Ok((nuke, max_capacity, policy))
    };
    let Ok((nuke, max_capacity, policy)) = read() else {
        return false;
    };
    let capacity = effective_capacity(max_capacity, volume_size(&root));
    trash_allowed(drive_type, guid.is_some(), policy, nuke, capacity, size)
}

fn bin_key(guid: &str) -> String {
    format!("{BIT_BUCKET}{guid}")
}

/// `MaxCapacity` of the bin of the volume `guid`, in bytes; `Ok(None)` if not set.
fn max_capacity(guid: &str) -> Result<Option<u64>, ()> {
    Ok(dword(HKEY_CURRENT_USER, &bin_key(guid), "MaxCapacity")?
        .map(|megabytes| u64::from(megabytes) << 20))
}

/// The size of the volume mounted at `root` (as the current user's quota allows).
fn volume_size(root: &[u16]) -> Option<u64> {
    let mut total = 0u64;
    // SAFETY: `root` is NUL-terminated; the values not wanted may be null.
    let read = unsafe { GetDiskFreeSpaceExW(root.as_ptr(), null_mut(), &mut total, null_mut()) };
    (read != 0).then_some(total)
}

/// The mount point of the volume of `path` (`C:\` or a mounted folder), NUL-terminated.
fn volume_root(path: &Path) -> Option<Vec<u16>> {
    let wide = wide_nul(path);
    let mut root = vec![0u16; 1024];
    // SAFETY: `wide` is NUL-terminated and `root` has the capacity we pass.
    if unsafe { GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), root.len() as u32) } == 0 {
        return None;
    }
    let end = root.iter().position(|&c| c == 0)?;
    root.truncate(end + 1);
    Some(root)
}

/// `{GUID}` of the volume mounted at `root`, as the Recycle Bin settings name it.
fn volume_guid(root: &[u16]) -> Option<String> {
    let mut name = [0u16; 64];
    // SAFETY: `root` is NUL-terminated and ends with a backslash; `name` has room for
    // `\\?\Volume{GUID}\` and the NUL.
    if unsafe {
        GetVolumeNameForVolumeMountPointW(root.as_ptr(), name.as_mut_ptr(), name.len() as u32)
    } == 0
    {
        return None;
    }
    let name = String::from_utf16_lossy(&name[..name.iter().position(|&c| c == 0)?]);
    let (start, end) = (name.find('{')?, name.find('}')?);
    Some(name[start..=end].to_owned())
}

/// The DWORD `value` of `key` in `hive`, read only: `Ok(None)` if it is not set, `Err` if it
/// cannot be read.
fn dword(hive: HKEY, key: &str, value: &str) -> Result<Option<u32>, ()> {
    let key: Vec<u16> = key.encode_utf16().chain(Some(0)).collect();
    let value: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
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

/// The result of `RegGetValueW`: the value, no value (the key or the value does not exist), or
/// an error that says nothing about the setting.
fn read_status(status: u32, data: u32) -> Result<Option<u32>, ()> {
    match status {
        ERROR_SUCCESS => Ok(Some(data)),
        ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(None),
        _ => Err(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_fixed_drive_with_room_in_its_bin_takes_an_item() {
        const REMOVABLE: u32 = 2;
        const REMOTE: u32 = 4;
        const MB: u64 = 1 << 20;
        const VOLUME: Option<u64> = Some(100_000 * MB);
        let fixed = |max, size| {
            let capacity = effective_capacity(max, VOLUME);
            trash_allowed(DRIVE_FIXED, true, false, false, capacity, size)
        };
        assert!(
            !fixed(None, u64::MAX),
            "above the default 5 % of the volume"
        );
        assert!(fixed(None, 5_000 * MB), "the default 5 % of the volume");
        assert!(!fixed(None, 5_000 * MB + 1));
        assert!(fixed(Some(10 * MB), 10 * MB));
        assert!(!fixed(Some(10 * MB), 10 * MB + 1), "bigger than the bin");
        assert!(fixed(Some(10_000 * MB), 10_000 * MB), "a set limit wins");
        assert!(
            !trash_allowed(
                DRIVE_FIXED,
                true,
                false,
                false,
                effective_capacity(None, None),
                1
            ),
            "no limit and no volume size"
        );
        assert!(
            !trash_allowed(DRIVE_FIXED, true, false, true, Some(MB), 1),
            "the bin is turned off"
        );
        assert!(
            !trash_allowed(DRIVE_FIXED, true, true, false, Some(MB), 1),
            "a policy deletes files at once"
        );
        assert!(
            !trash_allowed(DRIVE_FIXED, false, false, false, Some(MB), 1),
            "the volume is unknown, so are its bin settings"
        );
        assert!(!trash_allowed(REMOVABLE, true, false, false, Some(MB), 1));
        assert!(!trash_allowed(REMOTE, true, false, false, Some(MB), 1));
    }

    #[test]
    fn only_a_missing_setting_counts_as_not_set() {
        use windows_sys::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_MORE_DATA};
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
    fn the_temporary_folder_takes_a_small_item() {
        // The system reader on the drive of %TEMP%: a fixed drive with its bin on by default.
        assert!(can_recycle(&std::env::temp_dir(), 1));
        assert!(!can_recycle(&std::env::temp_dir(), u64::MAX));
    }

    #[test]
    fn the_bin_of_the_temporary_folder_has_a_capacity() {
        // Read only: the bin's settings and its size, nothing is moved.
        let space = bin_space(&std::env::temp_dir()).expect("the bin of the system drive");
        assert!(space.capacity > 0);
    }
}
