//! Places and names that are never touched, by any rule, in the list and before deleting.
//!
//! Anchored entries close their place at the known folder they are written for. Anywhere names
//! block a folder that holds them at any depth, wherever it lies.

use std::sync::LazyLock;

use super::Os;
use super::names::Names;
use super::paths::{At, Known, components};
use super::pattern::{Entry, Hit, Pattern, State, add, is_never, start, step};

/// Names that block any folder holding them, compared ignoring case on every OS.
const ANYWHERE: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".git-credentials",
    ".npmrc",
    ".pypirc",
    "NuGet.config",
    "*.pst",
    "*.ost",
    "*.vhd",
    "*.vhdx",
    "*.avhd",
    "*.avhdx",
    "*.vmdk",
    "*.vdi",
    "*.qcow2",
    "*.gguf",
    "*.safetensors",
    "*.ckpt",
    "models--*",
    "huggingface",
    "lm-studio",
    ".ollama",
    "found.000",
    "*.chk",
    "tdata",
];

/// Whether `name` is one of the anywhere names: an item holding it is never offered.
pub fn is_protected_name(name: &str) -> bool {
    PROTECTED.has(&name.to_ascii_lowercase())
}

pub(crate) static PROTECTED: LazyLock<Names> = LazyLock::new(|| Names::new(ANYWHERE, true));

/// Shared by every OS: work of AI tools, models, the user's libraries.
const COMMON: &[Entry] = &[
    (At::Home, &[".claude"]),
    (At::Home, &[".codex"]),
    (At::Home, &[".cursor"]),
    (At::Home, &[".cache", "huggingface"]),
    (At::Home, &[".cache", "torch"]),
    (At::Home, &[".cache", "lm-studio"]),
    (At::Home, &[".lmstudio"]),
    (At::Home, &[".nuget", "packages"]),
    (At::Home, &[".pnpm-store"]),
    (At::Home, &["*conda*"]),
    (At::Home, &["miniforge*"]),
    (At::Home, &["mambaforge*"]),
    (At::Home, &["pipx"]),
    (At::Home, &[".local", "pipx"]),
    (At::Home, &["Desktop"]),
    (At::Home, &["Documents"]),
    (At::Home, &["Downloads"]),
    (At::Home, &["Pictures"]),
    (At::Home, &["Music"]),
    (At::Home, &["Videos"]),
    (At::Home, &["Movies"]),
    (At::Home, &["VirtualBox VMs"]),
    (At::NpmCache, &["_npx"]),
    (At::Cloud, &[]),
];

const WINDOWS: &[Entry] = &[
    // Work in progress and recovery.
    (At::Temp, &["claude*"]),
    (At::Temp, &["codex*"]),
    (At::Temp, &["Low"]),
    (
        At::Local,
        &["Microsoft", "Windows", "INetCache", "Content.Outlook"],
    ),
    (
        At::Local,
        &["Microsoft", "Windows", "INetCache", "Content.MSO"],
    ),
    (At::Local, &["Microsoft", "Office", "UnsavedFiles"]),
    (At::Roaming, &["Code", "User"]),
    (At::Roaming, &["Cursor", "User"]),
    (At::Local, &["JetBrains", "*", "LocalHistory"]),
    // Installed tools and package stores.
    (At::Roaming, &["npm"]),
    (At::Local, &["Programs"]),
    (At::Local, &["Microsoft", "WindowsApps"]),
    (At::ProgramFiles, &["WindowsApps"]),
    (At::Local, &["Packages"]),
    (At::Local, &["uv"]),
    (At::Roaming, &["uv"]),
    (At::Local, &["pipx"]),
    (At::Local, &["pnpm"]),
    (At::Roaming, &["nvm"]),
    (At::Local, &["nvm"]),
    (At::Roaming, &["fnm"]),
    (At::Local, &["fnm"]),
    (At::Local, &["Volta"]),
    (At::Local, &["Docker"]),
    // Browser data other than caches: see `BROWSER_DATA`.
    (At::Roaming, &["Mozilla"]),
    (At::Local, &["Mozilla", "Firefox", "Profiles", "*", "*"]),
    (At::Roaming, &["Thunderbird"]),
    (At::Local, &["Thunderbird"]),
    // Secrets.
    (At::Roaming, &["Microsoft", "Credentials"]),
    (At::Roaming, &["Microsoft", "Vault"]),
    (At::Roaming, &["Microsoft", "Protect"]),
    (At::Roaming, &["Microsoft", "Crypto"]),
    (At::Local, &["Microsoft", "Credentials"]),
    (At::Local, &["Microsoft", "Vault"]),
    // System.
    (At::SystemRoot, &["*"]),
    (At::SystemDrive, &["System Volume Information"]),
    (At::SystemDrive, &["$Recycle.Bin"]),
    (At::SystemDrive, &["Recovery"]),
    (At::SystemDrive, &["Config.Msi"]),
    (At::SystemDrive, &["$WinREAgent"]),
    (At::SystemDrive, &["Windows.old"]),
    (At::SystemDrive, &["$WINDOWS.~BT"]),
    (At::SystemDrive, &["$WINDOWS.~WS"]),
    (At::SystemDrive, &["pagefile.sys"]),
    (At::SystemDrive, &["swapfile.sys"]),
    (At::SystemDrive, &["hiberfil.sys"]),
    (At::ProgramData, &["Package Cache"]),
    (At::ProgramData, &["Microsoft", "Search"]),
    (At::ProgramData, &["Microsoft", "Windows Defender"]),
    (At::Home, &["NTUSER*"]),
    (At::Local, &["Microsoft", "Windows", "UsrClass.dat*"]),
    // Libraries.
    (At::Home, &["Saved Games"]),
    (At::Home, &["Favorites"]),
    (At::Home, &["Apple", "MobileSync"]),
    (At::Roaming, &["Apple Computer", "MobileSync"]),
    (At::ProgramFiles, &["Steam", "userdata"]),
    (At::ProgramFiles, &["Steam", "steamapps"]),
];

/// Re-opened inside a never place: rules may match here.
const WINDOWS_OPEN: &[Entry] = &[
    (At::SystemRoot, &["Temp"]),
    (At::SystemRoot, &["Minidump"]),
    (At::SystemRoot, &["MEMORY.DMP"]),
    (
        At::Local,
        &["Mozilla", "Firefox", "Profiles", "*", "cache2"],
    ),
];

const MAC: &[Entry] = &[
    (At::Home, &["Library", "Application Support"]),
    (At::Home, &["Library", "Containers"]),
    (At::Home, &["Library", "Group Containers"]),
    (At::Home, &["Library", "Mail"]),
    (At::Home, &["Library", "Messages"]),
    (At::Home, &["Library", "Photos"]),
    (At::Home, &["Library", "Mobile Documents"]),
    (At::Home, &["Library", "Safari"]),
    (At::Home, &["Library", "Keychains"]),
    (At::Home, &["Library", "Caches", "com.apple.*"]),
    (At::Home, &[".Trash"]),
    (At::FsRoot, &["Volumes", "*", "Backups.backupdb"]),
    (At::FsRoot, &["System"]),
];

const LINUX: &[Entry] = &[
    (At::FsRoot, &["etc"]),
    (At::FsRoot, &["usr"]),
    (At::FsRoot, &["var", "lib"]),
    (At::FsRoot, &["tmp"]),
    (At::FsRoot, &["proc"]),
    (At::FsRoot, &["sys"]),
    (At::FsRoot, &["dev"]),
    (At::FsRoot, &["boot"]),
    (At::Home, &[".local", "share", "Trash"]),
    (At::Home, &[".mozilla"]),
    (At::Home, &[".thunderbird"]),
];

/// Site data, cookies and extensions of Chromium browsers (`<vendor>\<browser>\User Data\
/// <profile>`, `Vivaldi\User Data\<profile>`), Opera (`Opera Software\<browser>[\Default]`) and
/// Electron apps (`%APPDATA%\<app>`): each name of `BROWSER_DATA` below each root (Windows).
const BROWSER_ROOTS: &[Entry] = &[
    (At::Local, &["*", "*", "User Data", "*"]),
    (At::Local, &["*", "User Data", "*"]),
    (At::Roaming, &["*"]),
    (At::Roaming, &["*", "*"]),
    (At::Roaming, &["*", "*", "*"]),
];
const BROWSER_DATA: &[&str] = &[
    "Service Worker",
    "IndexedDB",
    "Local Storage",
    "Session Storage",
    "File System",
    "Extensions",
    "Network",
];

/// The anchored never entries of `os` and the places re-opened inside them.
fn tables(os: Os) -> [(&'static [Entry], Hit); 3] {
    match os {
        Os::Windows => [
            (COMMON, Hit::Never),
            (WINDOWS, Hit::Never),
            (WINDOWS_OPEN, Hit::Open),
        ],
        Os::Mac => [(COMMON, Hit::Never), (MAC, Hit::Never), (&[], Hit::Open)],
        Os::Linux => [(COMMON, Hit::Never), (LINUX, Hit::Never), (&[], Hit::Open)],
    }
}

/// Adds the never patterns of `os` to `out`.
pub(crate) fn add_never<'a>(out: &mut Vec<Pattern<'a>>, os: Os, known: &'a Known) {
    for (entries, hit) in tables(os) {
        for &(at, path) in entries {
            add(out, (os, known), (at, path, None), hit);
        }
    }
    if os == Os::Windows {
        for &(at, root) in BROWSER_ROOTS {
            for &name in BROWSER_DATA {
                add(out, (os, known), (at, root, Some(name)), Hit::Never);
            }
        }
    }
}

/// The never check for the re-check right before deleting: [`Guard::blocks`] for one path, or
/// [`Guard::start`] / [`Guard::enter`] to carry the check down a walk at the cost of one step per
/// entry.
pub struct Guard<'a> {
    os: Os,
    patterns: Vec<Pattern<'a>>,
}

/// Where a walk checked by a [`Guard`] stands: the never places that may still lie below.
#[derive(Clone, Debug)]
pub struct Trail(State);

impl<'a> Guard<'a> {
    pub fn new(os: Os, known: &'a Known) -> Guard<'a> {
        let mut patterns = Vec::new();
        add_never(&mut patterns, os, known);
        Guard { os, patterns }
    }

    /// The trail of `path`, or `None` when it lies at or below a never place or has an anywhere
    /// name on its way.
    pub fn start(&self, path: &str) -> Option<Trail> {
        let mut trail = Trail(start(&self.patterns));
        for name in components(self.os, path) {
            trail = self.enter(&trail, name)?;
        }
        Some(trail)
    }

    /// The trail of the entry `name` inside the folder of `at`, or `None` when it is never
    /// touched.
    pub fn enter(&self, at: &Trail, name: &str) -> Option<Trail> {
        let state = step(&self.patterns, &at.0, name);
        (!is_never(&self.patterns, &state) && !is_protected_name(name)).then_some(Trail(state))
    }

    /// Whether `path` lies at or below a never place, or has an anywhere name on its way.
    pub fn blocks(&self, path: &str) -> bool {
        self.start(path).is_none()
    }
}
