//! Zones of the duplicate search, from the clean-up path knowledge: system places, installed
//! programs, app data, projects and packages, where a copy is not the user's to remove. Unlike
//! the clean-up zones, other users' profiles count, only their `AppData` does not. Cloud sync
//! folders are no zone, only a mark.

use crate::cleanup::Os;
use crate::cleanup::names::{Names, lower};
use crate::cleanup::paths::{At, Known};
use crate::cleanup::pattern::{self, Entry, Hit, Pattern, State};
use crate::cleanup::zones::{LINUX, MAC, NAMES};
use crate::tree::Tree;

const COMMON: &[Entry] = &[(At::Home, &[".*"])];

const WINDOWS: &[Entry] = &[
    (At::AnyVolume, &["Windows"]),
    (At::AnyVolume, &["Windows.old"]),
    (At::AnyVolume, &["ProgramData"]),
    (At::AnyVolume, &["Recovery"]),
    (At::AnyVolume, &["$WinREAgent"]),
    (At::AnyVolume, &["Users", "*", "AppData"]),
    (At::Users, &["*", "AppData"]),
    (At::Home, &["AppData"]),
    (At::SystemRoot, &[]),
    (At::ProgramData, &[]),
    (At::ProgramFiles, &[]),
];

const LINUX_MORE: &[Entry] = &[
    (At::FsRoot, &["etc"]),
    (At::FsRoot, &["boot"]),
    (At::FsRoot, &["bin"]),
    (At::FsRoot, &["sbin"]),
    (At::FsRoot, &["lib*"]),
];

const SYNCED: &[Entry] = &[(At::Cloud, &[])];

/// Zone names at any depth on every OS, ignoring case, besides the clean-up ones.
const PROJECTS: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "venv",
    ".venv",
    "site-packages",
];

/// macOS packages and libraries: their content belongs to the app.
const PACKAGES: &[&str] = &["*.app", "*.photoslibrary", "*.aplibrary", "*.lrlibrary"];

/// A folder holding this file is a Python environment.
const VENV_MARKER: &str = "pyvenv.cfg";

/// What the path of a node lies in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Mark {
    pub zone: bool,
    pub synced: bool,
}

pub(crate) struct Zones<'a> {
    patterns: Vec<Pattern<'a>>,
    /// Patterns from this index on mark synced folders; the ones before it are zones.
    synced_from: usize,
    names: Names,
}

impl<'a> Zones<'a> {
    pub(crate) fn new(os: Os, known: &'a Known) -> Zones<'a> {
        let own: &[&[Entry]] = match os {
            Os::Windows => &[WINDOWS],
            Os::Mac => &[MAC],
            Os::Linux => &[LINUX, LINUX_MORE],
        };
        let mut patterns = Vec::new();
        for &(at, path) in COMMON.iter().chain(own.iter().copied().flatten()) {
            pattern::add(&mut patterns, (os, known), (at, path, None), Hit::Zone);
        }
        let synced_from = patterns.len();
        for &(at, path) in SYNCED {
            pattern::add(&mut patterns, (os, known), (at, path, None), Hit::Zone);
        }
        let mut names = [NAMES, PROJECTS].concat();
        if os == Os::Mac {
            names.extend_from_slice(PACKAGES);
        }
        Zones {
            patterns,
            synced_from,
            names: Names::new(&names, true),
        }
    }

    /// Nothing matched yet: the state above the root of the file system.
    pub(crate) fn start(&self) -> State {
        pattern::start(&self.patterns)
    }

    /// The state and mark of a node named `name` below a folder of `state` and `mark`. `buf` is
    /// reused from node to node. A zone closes its subtree: only synced folders are looked for
    /// below it.
    pub(crate) fn step(
        &self,
        state: &State,
        mut mark: Mark,
        name: &str,
        buf: &mut String,
    ) -> (State, Mark) {
        let mut state = pattern::step(&self.patterns, state, name);
        for &(p, m) in &state {
            if self.patterns[p as usize].comps.len() == m as usize {
                if (p as usize) < self.synced_from {
                    mark.zone = true;
                } else {
                    mark.synced = true;
                }
            }
        }
        mark.zone |= self.names.has(lower(name, buf));
        if mark.zone {
            state.retain(|&(p, _)| p as usize >= self.synced_from);
        }
        (state, mark)
    }
}

/// Whether folder `id` holds a `pyvenv.cfg` file.
// ponytail: the walk reads each folder's children twice (here and when it pops the folder),
// a cheap name compare; fold into one pass by deferring the folder's mark if it ever shows up.
pub(crate) fn is_venv(tree: &Tree, id: u32) -> bool {
    tree.children(id)
        .any(|c| !tree.node(c).is_dir() && tree.name(c).eq_ignore_ascii_case(VENV_MARKER))
}
