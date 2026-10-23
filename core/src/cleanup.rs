//! Clean-up lists: junk the big cleaners remove without asking ("Can be cleaned") and items that
//! cost time or data to rebuild ("Check before deleting"), found in a finished scan.
//!
//! Rules are data ([`Rule`]) matched in one walk over the tree. A matched item closes its subtree
//! for every rule; places the spec says never to touch close theirs before any rule is tried.

use serde::Serialize;

use crate::tree::Tree;

mod age;
mod build;
mod caches;
mod markers;
mod names;
mod never;
mod paths;
mod pattern;
mod recheck;
mod report;
mod rules;
mod spots;
mod table;
mod temp;
mod unix_rules;
mod walk;
mod zones;

pub use age::{is_old, newest_mtime};
pub use never::{Guard, Trail, is_protected_name};
pub use paths::{At, Known, Overrides};
pub use recheck::{Refusal, recheck};
pub use table::{Age, App, Marker, Place, Rule, Spot, SpotKind, Target};

/// Which rule and never tables apply. Chosen by value, not by `cfg`, so every table can be tested
/// on every OS.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    /// Paths split on `\` and `/`, names compared ignoring case.
    Windows,
    /// Paths split on `/`; rule places compared by case, never places and zones ignoring case
    /// (APFS is case-insensitive by default).
    Mac,
    /// Paths split on `/`, names compared by case.
    Linux,
}

impl Os {
    /// Whether rule places and targets compare names ignoring case.
    pub(crate) fn folds(self) -> bool {
        self == Os::Windows
    }

    pub fn current() -> Os {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Mac
        } else {
            Os::Linux
        }
    }
}

/// A running process.
#[derive(Clone, Debug, Default)]
pub struct Running {
    /// Lower-case file name of the executable.
    pub exe: String,
    /// Lower-case command line, arguments joined by spaces.
    pub cmd: String,
}

/// Everything the lists depend on besides the tree.
#[derive(Clone, Debug)]
pub struct Context {
    pub os: Os,
    pub known: Known,
    pub running: Vec<Running>,
    /// Windows has file operations waiting for a restart.
    pub reboot_pending: bool,
    /// The scanned volume has a recycle bin; "anywhere" rules list nothing without one.
    pub recyclable: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Cleanup,
    Review,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    TempOld,
    TempLarge,
    TempWork,
    CrashDump,
    CrashDumpRecent,
    ErrorReport,
    WindowsCache,
    ShaderCache,
    BrowserCache,
    AppCache,
    PackageCache,
    PythonBytecode,
    NodeModules,
    PythonVenv,
    GradleCache,
    DiscordCache,
    XcodeDerived,
}

/// One listed item.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Row {
    pub id: u32,
    pub mode: Mode,
    pub reason: Reason,
    /// The tool's own clean-up command, for the user to run.
    pub command: Option<&'static str>,
    /// For `node_modules` and venvs: a lock file lies next to them, so they can be restored.
    pub restorable: Option<bool>,
}

/// Facts shown as text under the total: never rows, never deleted, not in the total.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Info {
    Pagefile {
        id: u32,
    },
    Hiberfil {
        id: u32,
    },
    PreviousWindows {
        id: u32,
    },
    WindowsUpdate {
        id: u32,
    },
    DeliveryOptimization {
        id: u32,
    },
    ToolStore {
        id: u32,
        command: &'static str,
    },
    /// A place a rule or a spot looks at could not be read.
    NoAccess {
        id: u32,
        /// The place written by the rules of the listed OS. The app shows its own path of `id`;
        /// this text is for the core's tests and debug output.
        path: String,
        /// Found on the way to an info spot: it concerns only the info, never a row or a total.
        spot: bool,
    },
    /// The rows of a running app in one mode: their ids and their summed size.
    AppRunning {
        app: &'static str,
        mode: Mode,
        ids: Vec<u32>,
        /// The whole tree's sum; the app sums the `ids` inside the listed folder instead.
        size: u64,
    },
}

/// Every match in the whole tree; the app filters by folder, ranks and caps.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Cleanup {
    pub cleanup: Vec<Row>,
    pub review: Vec<Row>,
    pub info: Vec<Info>,
    /// The tree is approximate or a place could not be read.
    pub approximate: bool,
}

/// The rule and spot tables of `os`.
fn tables(os: Os) -> (&'static [Rule], &'static [Spot]) {
    match os {
        Os::Windows => (&rules::WINDOWS, rules::SPOTS),
        Os::Mac => (&unix_rules::MAC, &[]),
        Os::Linux => (&unix_rules::LINUX, &[]),
    }
}

impl Tree {
    /// The clean-up lists of the whole tree.
    pub fn cleanup(&self, ctx: &Context) -> Cleanup {
        let (rules, spots) = tables(ctx.os);
        self.cleanup_with(ctx, rules, spots)
    }

    pub(crate) fn cleanup_with(&self, ctx: &Context, rules: &[Rule], spots: &[Spot]) -> Cleanup {
        let mut out = walk::run(self, ctx, rules, spots);
        for info in spots::find(self, ctx, spots) {
            if !out.info.contains(&info) {
                out.info.push(info);
            }
        }
        let no_access = |i: &Info| matches!(i, Info::NoAccess { .. });
        out.approximate = self.approximate || out.info.iter().any(no_access);
        out
    }
}

#[cfg(test)]
mod recheck_tests;
#[cfg(test)]
mod recheck_time_tests;
#[cfg(all(test, unix))]
mod recheck_unix_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_never;
#[cfg(test)]
mod tests_packages;
#[cfg(test)]
mod tests_paths;
#[cfg(test)]
mod tests_report;
#[cfg(test)]
mod tests_rules;
#[cfg(test)]
mod tests_temp;
#[cfg(test)]
mod tests_unix;
#[cfg(test)]
mod tests_windows;
#[cfg(test)]
mod tests_zones;
