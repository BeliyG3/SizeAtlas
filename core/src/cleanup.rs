//! Clean-up lists: junk the big cleaners remove without asking ("Can be cleaned") and items that
//! cost time or data to rebuild ("Check before deleting"), found in a finished scan.
//!
//! Rules are data ([`Rule`]) matched in one walk over the tree. A matched item closes its subtree
//! for every rule; places the spec says never to touch close theirs before any rule is tried.

use serde::Serialize;

use crate::tree::Tree;

mod age;
mod markers;
mod names;
mod never;
mod paths;
mod report;
mod spots;
mod walk;
mod zones;

pub use age::{is_old, newest_mtime};
pub use never::{Guard, is_protected_name};
pub use paths::{At, Known, Overrides};

/// Which rule and never tables apply. Chosen by value, not by `cfg`, so every table can be tested
/// on every OS.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    /// Paths split on `\` and `/`, names compared ignoring case.
    Windows,
    /// Paths split on `/`, names compared by case.
    Mac,
    Linux,
}

impl Os {
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
    /// A place a rule looks at could not be read.
    NoAccess {
        path: String,
    },
    /// The rows of a running app, summed.
    AppRunning {
        app: &'static str,
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

/// Where a rule looks.
#[derive(Clone, Copy, Debug)]
pub enum Place {
    /// Below a known folder. Each component is a name or a mask with `*` (`Opera*`), compared
    /// by the case rule of the OS; the target is matched one level below the last component.
    At(At, &'static [&'static str]),
    /// Anywhere outside the zones of "anywhere" rules (installed programs, other users, AppData,
    /// home dot-folders, cloud folders, volumes without a recycle bin, ...).
    Anywhere,
}

/// What the matched item must be: a name or mask (`*`, `*.crate`, `thumbcache_*`).
#[derive(Clone, Copy, Debug)]
pub enum Target {
    Dir(&'static str),
    File(&'static str),
    Any(&'static str),
}

/// A condition on the files around a matched folder.
#[derive(Clone, Copy, Debug)]
pub enum Marker {
    /// A name next to the item, in the same folder (`package.json` by `node_modules`,
    /// `Preferences` by a browser profile's `Cache`).
    Sibling(&'static str),
    /// A name directly inside the item (`pyvenv.cfg` in a venv).
    Inside(&'static str),
    /// The item holds only files, each fitting one of these masks (`__pycache__`).
    Only(&'static [&'static str]),
}

/// An app whose rows are not offered while it runs.
#[derive(Clone, Copy, Debug)]
pub struct App {
    /// Shown in "Close {app}".
    pub name: &'static str,
    /// Lower-case masks of executable file names (`chrome.exe`, `discord*.exe`).
    pub exes: &'static [&'static str],
    /// Must appear in the lower-case command line (`npm-cli.js` for `node.exe`).
    pub cmd: Option<&'static str>,
}

/// An age split: items whose newest time is older than `days` keep the rule's mode and reason.
#[derive(Clone, Copy, Debug)]
pub struct Age {
    pub days: u32,
    /// Where younger items go; `None` lists them nowhere.
    pub young: Option<(Mode, Reason)>,
}

/// One rule of a table.
#[derive(Clone, Copy, Debug)]
pub struct Rule {
    pub place: Place,
    pub target: Target,
    pub mode: Mode,
    pub reason: Reason,
    pub app: Option<&'static App>,
    pub age: Option<Age>,
    pub marker: Option<Marker>,
    pub command: Option<&'static str>,
    /// A Temp item: work markers inside it send it to Review (`TempWork`), and so does a size
    /// above 1 GiB (`TempLarge`). Applies to old items only.
    pub temp: bool,
    /// A pending restart hides the rule's items (`%SystemRoot%\Temp`).
    pub reboot_blocks: bool,
}

impl Rule {
    /// A rule with no conditions; set the others with struct update syntax.
    pub const fn new(place: Place, target: Target, mode: Mode, reason: Reason) -> Rule {
        Rule {
            place,
            target,
            mode,
            reason,
            app: None,
            age: None,
            marker: None,
            command: None,
            temp: false,
            reboot_blocks: false,
        }
    }
}

/// A place reported as [`Info`] with its size; found by path, even inside a never zone.
#[derive(Clone, Copy, Debug)]
pub struct Spot {
    pub at: At,
    /// Components below `at`; the last one is the spot itself.
    pub path: &'static [&'static str],
    pub kind: SpotKind,
}

#[derive(Clone, Copy, Debug)]
pub enum SpotKind {
    Pagefile,
    Hiberfil,
    PreviousWindows,
    WindowsUpdate,
    DeliveryOptimization,
    ToolStore(&'static str),
}

/// The rule and spot tables of `os`; empty until the tables are written.
fn tables(_os: Os) -> (&'static [Rule], &'static [Spot]) {
    (&[], &[])
}

impl Tree {
    /// The clean-up lists of the whole tree.
    pub fn cleanup(&self, ctx: &Context) -> Cleanup {
        let (rules, spots) = tables(ctx.os);
        self.cleanup_with(ctx, rules, spots)
    }

    pub(crate) fn cleanup_with(&self, ctx: &Context, rules: &[Rule], spots: &[Spot]) -> Cleanup {
        let mut out = walk::run(self, ctx, rules);
        out.info.extend(spots::find(self, ctx, spots));
        out.approximate |= self.approximate;
        out
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_never;
#[cfg(test)]
mod tests_paths;
#[cfg(test)]
mod tests_rules;
#[cfg(test)]
mod tests_zones;
