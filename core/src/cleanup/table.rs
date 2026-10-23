//! The entries of the rule and spot tables: where a rule looks, what it matches and the
//! conditions it sets.

use super::paths::At;
use super::{Mode, Reason};

/// Where a rule looks.
#[derive(Clone, Copy, Debug)]
pub enum Place {
    /// Below a known folder. Each component is a name or a mask with `*` (`Opera*`), compared
    /// by the case rule of the OS; the target is matched one level below the last component.
    At(At, &'static [&'static str]),
    /// The known folder itself, for caches an override may move (`GOCACHE`); the target gives
    /// only the kind. Give such a rule a marker, so an odd override offers nothing.
    Is(At),
    /// Anywhere outside the zones of "anywhere" rules (installed programs, other users, AppData,
    /// home dot-folders, cloud folders, volumes without a recycle bin, ...).
    Anywhere,
}

/// What the matched item must be: a name or mask (`*`, `*.crate`, `discord*`).
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
    /// Lower-case masks of executable file names, with any command line (`chrome.exe`,
    /// `discord*.exe`).
    pub exes: &'static [&'static str],
    /// An executable mask and a text its command line must hold, compared ignoring case
    /// (`node.exe` running `npm-cli.js`): tools whose runtime also runs other programs.
    pub cmds: &'static [(&'static str, &'static str)],
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
