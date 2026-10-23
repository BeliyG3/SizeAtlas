//! Zones of "anywhere" rules (`node_modules`, venvs, `__pycache__`): installed programs, other
//! users, app data and tool folders keep live copies of these, so such rules never look there.

use std::sync::LazyLock;

use super::names::Names;
use super::paths::{At, Known};
use super::pattern::{Entry, Hit, Pattern, add};
use super::{Context, Os};

const COMMON: &[Entry] = &[
    (At::ProgramFiles, &[]),
    (At::ProgramData, &[]),
    (At::Users, &["*"]),
    (At::Cloud, &[]),
    (At::SystemRoot, &[]),
    (At::Local, &[]),
    (At::LocalLow, &[]),
    (At::Roaming, &[]),
    (At::Home, &[".*"]),
];

const WINDOWS: &[Entry] = &[(At::Home, &["AppData"])];

const MAC: &[Entry] = &[
    (At::Home, &["Library"]),
    (At::FsRoot, &["Applications"]),
    (At::FsRoot, &["Library"]),
    (At::FsRoot, &["System"]),
    (At::FsRoot, &["opt"]),
    (At::FsRoot, &["usr"]),
    (At::FsRoot, &["private"]),
];

const LINUX: &[Entry] = &[
    (At::FsRoot, &["usr"]),
    (At::FsRoot, &["opt"]),
    (At::FsRoot, &["snap"]),
    (At::FsRoot, &["var"]),
    (At::FsRoot, &["nix"]),
];

/// Zone names at any depth, ignoring case.
const NAMES: &[&str] = &[
    "$Recycle.Bin",
    "System Volume Information",
    "Program Files",
    "Program Files (x86)",
    "WindowsApps",
    "steamapps",
    ".Trashes",
    ".Trash-*",
];

/// Adds the zone patterns of `os`; the user's own profile is re-opened inside `Users`.
pub(crate) fn add_zones<'a>(out: &mut Vec<Pattern<'a>>, os: Os, known: &'a Known) {
    let own = match os {
        Os::Windows => WINDOWS,
        Os::Mac => MAC,
        Os::Linux => LINUX,
    };
    for &(at, path) in COMMON.iter().chain(own) {
        add(out, (os, known), (at, path, None), Hit::Zone);
    }
    add(out, (os, known), (At::Home, &[], None), Hit::ZoneOpen);
}

pub(crate) static ZONE_NAMES: LazyLock<Names> = LazyLock::new(|| Names::new(NAMES, true));

/// "Anywhere" rules need a recycle bin and, on Windows, every place that holds installed
/// programs or other users' files: without one of them they list nothing (fail closed).
pub(crate) fn anywhere_allowed(ctx: &Context) -> bool {
    let places = [At::SystemRoot, At::ProgramData, At::ProgramFiles, At::Users];
    ctx.recyclable
        && (ctx.os != Os::Windows
            || places
                .iter()
                .all(|at| !at.bases(ctx.os, &ctx.known).is_empty()))
}
