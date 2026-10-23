//! Places and names that are never touched, by any rule, in the list and before deleting.
//!
//! Anchored entries close their place at the known folder they are written for. Anywhere names
//! block a folder that holds them at any depth, wherever it lies.

use std::sync::LazyLock;

use super::Os;
use super::names::Names;
use super::paths::{At, Hit, Known, Pattern, add, components, is_never, step};

type Entry = (At, &'static [&'static str]);

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

/// The never check for one path at a time, for the re-check right before deleting.
pub struct Guard<'a> {
    os: Os,
    patterns: Vec<Pattern<'a>>,
}

impl<'a> Guard<'a> {
    pub fn new(os: Os, known: &'a Known) -> Guard<'a> {
        let mut patterns = Vec::new();
        add_never(&mut patterns, os, known);
        Guard { os, patterns }
    }

    /// Whether `path` lies at or below a never place, or has an anywhere name on its way.
    pub fn blocks(&self, path: &str) -> bool {
        let fold = self.os == Os::Windows;
        let mut state: Vec<(u32, u8)> = (0..self.patterns.len() as u32).map(|p| (p, 0)).collect();
        for name in components(self.os, path) {
            state = step(&self.patterns, &state, name, fold);
            if is_never(&self.patterns, &state) || is_protected_name(name) {
                return true;
            }
        }
        false
    }
}
