//! Whether an item would go to the Recycle Bin or be deleted for good.

use std::path::Path;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::S_OK;
use windows_sys::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetVolumeNameForVolumeMountPointW,
};
use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use windows_sys::Win32::UI::Shell::{SHQUERYRBINFO, SHQueryRecycleBinW};

use super::registry::dword;
use super::volume_root;
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

/// What limits the bin of a volume.
#[derive(Clone, Copy, Debug, Default)]
struct Limits {
    /// The bin's own `MaxCapacity`, in bytes.
    max_capacity: Option<u64>,
    /// The "Maximum allowed Recycle Bin size" policy (`RecycleBinSize`), in percent of the
    /// volume: the smaller of the user's and the machine's.
    policy_percent: Option<u32>,
}

/// The size limit of a bin, for every check of the trash: `MaxCapacity` when set, else the
/// Windows default for a volume of `volume_size` bytes, and never more than the policy allows;
/// `None` when it cannot be known.
///
/// ponytail: the default of a bin never configured is taken as 5 % of the volume. Windows gives
/// at least that, so this refuses some items the real bin would take, never the other way.
fn effective_capacity(limits: Limits, volume_size: Option<u64>) -> Option<u64> {
    let own = limits.max_capacity.or(volume_size.map(|size| size / 20))?;
    match limits.policy_percent {
        None => Some(own),
        Some(percent) => Some(own.min(volume_size? / 100 * u64::from(percent.min(100)))),
    }
}

/// The bin of the volume of `path`: its [`effective_capacity`] and the bytes it holds (for
/// "the bin holds {free} more"). `None` when either cannot be read.
pub fn bin_space(path: &Path) -> Option<BinSpace> {
    let root = volume_root(path)?;
    let guid = volume_guid(&root)?;
    let capacity = effective_capacity(limits(&guid).ok()?, volume_size(&root))?;
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
            return Ok((false, Limits::default(), false));
        };
        let nuke =
            dword(HKEY_CURRENT_USER, &bin_key(guid), "NukeOnDelete")?.is_some_and(|v| v != 0);
        let mut policy = false;
        for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            policy |= dword(hive, EXPLORER_POLICIES, "NoRecycleFiles")?.is_some_and(|v| v != 0);
        }
        Ok((nuke, limits(guid)?, policy))
    };
    let Ok((nuke, limits, policy)) = read() else {
        return false;
    };
    let capacity = effective_capacity(limits, volume_size(&root));
    trash_allowed(drive_type, guid.is_some(), policy, nuke, capacity, size)
}

fn bin_key(guid: &str) -> String {
    format!("{BIT_BUCKET}{guid}")
}

/// The [`Limits`] of the bin of the volume `guid`.
fn limits(guid: &str) -> Result<Limits, ()> {
    let max_capacity = dword(HKEY_CURRENT_USER, &bin_key(guid), "MaxCapacity")?
        .map(|megabytes| u64::from(megabytes) << 20);
    let mut policy_percent: Option<u32> = None;
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        if let Some(percent) = dword(hive, EXPLORER_POLICIES, "RecycleBinSize")? {
            policy_percent = Some(policy_percent.map_or(percent, |p| p.min(percent)));
        }
    }
    Ok(Limits {
        max_capacity,
        policy_percent,
    })
}

/// The size of the volume mounted at `root` (as the current user's quota allows).
fn volume_size(root: &[u16]) -> Option<u64> {
    let mut total = 0u64;
    // SAFETY: `root` is NUL-terminated; the values not wanted may be null.
    let read = unsafe { GetDiskFreeSpaceExW(root.as_ptr(), null_mut(), &mut total, null_mut()) };
    (read != 0).then_some(total)
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

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1 << 20;
    const VOLUME: Option<u64> = Some(100_000 * MB);

    fn caps(max_capacity: Option<u64>, policy_percent: Option<u32>) -> Limits {
        Limits {
            max_capacity,
            policy_percent,
        }
    }

    #[test]
    fn only_a_fixed_drive_with_room_in_its_bin_takes_an_item() {
        const REMOVABLE: u32 = 2;
        const REMOTE: u32 = 4;
        let fixed = |max, size| {
            let capacity = effective_capacity(caps(max, None), VOLUME);
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
        let unknown = effective_capacity(Limits::default(), None);
        assert!(
            !trash_allowed(DRIVE_FIXED, true, false, false, unknown, 1),
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
    fn the_size_policy_caps_the_bin() {
        let capacity = |max, percent| effective_capacity(caps(max, percent), VOLUME);
        assert_eq!(
            capacity(None, Some(1)),
            Some(1_000 * MB),
            "below the default"
        );
        assert_eq!(
            capacity(None, Some(50)),
            Some(5_000 * MB),
            "the default is smaller"
        );
        assert_eq!(capacity(Some(80_000 * MB), Some(10)), Some(10_000 * MB));
        assert_eq!(capacity(Some(10 * MB), Some(10)), Some(10 * MB));
        assert_eq!(capacity(None, Some(0)), Some(0));
        assert_eq!(capacity(Some(200_000 * MB), Some(300)), Some(100_000 * MB));
        assert_eq!(
            effective_capacity(caps(Some(MB), Some(10)), None),
            None,
            "a policy share of an unknown volume"
        );
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
