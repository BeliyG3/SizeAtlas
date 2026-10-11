//! Restarting as administrator on Windows, and the roots that the restarted app scans again.

use std::mem;
use std::sync::{Mutex, PoisonError};

use crate::error::CmdError;

/// The flag that names a root to scan again after the start; repeated once per root.
const RESCAN: &str = "--rescan";
/// The flag that names the instance that started this one as administrator.
const WAIT_PID: &str = "--wait-pid";
/// How long a restarted instance waits for the old one to close (it may be saving a scan).
const WAIT_MS: u32 = 30_000;

/// Roots named on the command line with `--rescan`, until the UI takes them.
#[derive(Default)]
pub struct StartupRescans(Mutex<Vec<String>>);

impl StartupRescans {
    pub fn from_args(args: impl IntoIterator<Item = String>) -> StartupRescans {
        StartupRescans(Mutex::new(parse_rescan_args(args)))
    }

    /// The roots, once: later calls get an empty list.
    pub fn take(&self) -> Vec<String> {
        mem::take(&mut *self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }
}

/// The value after every `--rescan`; a flag without a value is ignored.
pub fn parse_rescan_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut args = args.into_iter();
    let mut roots = Vec::new();
    while let Some(arg) = args.next() {
        if arg == RESCAN
            && let Some(root) = args.next()
        {
            roots.push(root);
        }
    }
    roots
}

/// The process named by `--wait-pid`; a missing, invalid or zero pid is ignored.
pub fn parse_wait_pid(args: impl IntoIterator<Item = String>) -> Option<u32> {
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == WAIT_PID {
            return args.next()?.parse().ok().filter(|&pid| pid != 0);
        }
    }
    None
}

/// `arg` in quotes, read back as one argument by `CommandLineToArgvW`: backslashes are
/// doubled only before a quote, including the closing one (so `C:\` becomes `"C:\\"`).
// Off Windows only the tests call it.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn quote_arg(arg: &str) -> String {
    let mut out = String::with_capacity(arg.len() + 2);
    out.push('"');
    let mut backslashes = 0;
    for c in arg.chars() {
        if c == '\\' {
            backslashes += 1;
            continue;
        }
        let escapes = if c == '"' {
            backslashes * 2 + 1
        } else {
            backslashes
        };
        out.extend(std::iter::repeat_n('\\', escapes));
        out.push(c);
        backslashes = 0;
    }
    out.extend(std::iter::repeat_n('\\', backslashes * 2));
    out.push('"');
    out
}

/// Whether this process runs with administrator rights (always false off Windows).
pub fn is_elevated() -> bool {
    #[cfg(windows)]
    {
        windows::is_elevated()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Waits up to [`WAIT_MS`] for the process `pid` to exit, so that the old and the elevated
/// instance never hold the WebView2 data folder at once. A process that cannot be opened has
/// exited already; after the timeout the start goes on.
pub fn wait_for_exit(pid: u32) {
    #[cfg(windows)]
    windows::wait_for_exit(pid, WAIT_MS);
    #[cfg(not(windows))]
    let _ = (pid, WAIT_MS);
}

/// Lets an elevated process read folders closed even to administrators: the scan opens
/// folders with backup semantics, which `SeBackupPrivilege` lets through. Only this read
/// privilege is enabled. False if it could not be (always false off Windows).
pub fn enable_backup_privilege() -> bool {
    #[cfg(windows)]
    {
        windows::enable_backup_privilege()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Starts this program again as administrator, asking to scan `roots` again. Returns once the
/// new process is started; `Cancelled` if the user declined the prompt.
pub fn restart_elevated(roots: &[String]) -> Result<(), CmdError> {
    #[cfg(windows)]
    {
        let wait = [WAIT_PID.to_owned(), std::process::id().to_string()];
        let rescans = roots
            .iter()
            .flat_map(|root| [RESCAN.to_owned(), quote_arg(root)]);
        let params: Vec<String> = wait.into_iter().chain(rescans).collect();
        windows::run_as(&params.join(" "))
    }
    #[cfg(not(windows))]
    {
        let _ = roots;
        Err(CmdError::Io {
            path: String::new(),
            os_message: "Restarting as administrator is only available on Windows.".into(),
        })
    }
}

#[cfg(windows)]
mod windows;

#[cfg(test)]
mod tests;
