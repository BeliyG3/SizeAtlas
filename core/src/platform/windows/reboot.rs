//! Whether Windows has file operations or updates waiting for a restart.

use windows_sys::Win32::System::Registry::HKEY_LOCAL_MACHINE;

use super::registry::{key_exists, value_exists};

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
    value_exists(
        HKEY_LOCAL_MACHINE,
        SESSION_MANAGER,
        "PendingFileRenameOperations",
    ) || REBOOT_KEYS
        .iter()
        .any(|key| key_exists(HKEY_LOCAL_MACHINE, key))
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_system_answers_without_failing() {
        // Read only; either answer is valid on a real machine.
        let _ = super::reboot_pending();
    }
}
