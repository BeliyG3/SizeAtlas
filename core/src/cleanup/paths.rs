//! Known folders as component lists, and matching those lists against node names.

use super::Os;
use crate::tree::{NO_PARENT, Tree, glob};

/// Known folders of the current user and the system, as plain path strings. An empty string,
/// or one with no components, means the folder does not exist on this OS.
#[derive(Clone, Debug, Default)]
pub struct Known {
    pub home: String,
    /// `%LOCALAPPDATA%`.
    pub local: String,
    /// `%LOCALAPPDATA%Low`.
    pub local_low: String,
    /// `%APPDATA%`.
    pub roaming: String,
    pub temp: String,
    /// `%SystemRoot%`.
    pub system_root: String,
    /// `%ProgramData%`.
    pub program_data: String,
    /// `%SystemDrive%\`.
    pub system_drive: String,
    /// `XDG_CACHE_HOME` (Linux; `~/.cache` when unset).
    pub xdg_cache: Option<String>,
    /// `Program Files`, `Program Files (x86)`; on Unix, folders of installed programs.
    pub program_files: Vec<String>,
    /// The folder holding every user's profile (`C:\Users`, `/home`, `/Users`); the parent of
    /// `home` when unset and that parent is `X:\<folder>`, `/home` or `/Users`; else unknown,
    /// and "anywhere" rules list nothing.
    pub users: Option<String>,
    /// Cloud sync folders (OneDrive, Dropbox, Google Drive, iCloud).
    pub cloud: Vec<String>,
    pub env: Overrides,
}

/// Cache locations moved by environment variables or the tools' own settings.
#[derive(Clone, Debug, Default)]
pub struct Overrides {
    pub nuget_http: Option<String>,
    pub pip_cache: Option<String>,
    pub npm_cache: Option<String>,
    pub cargo_home: Option<String>,
    pub gradle_home: Option<String>,
    pub go_cache: Option<String>,
}

/// A known folder a table entry is anchored at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum At {
    Home,
    Local,
    LocalLow,
    Roaming,
    Temp,
    SystemRoot,
    ProgramData,
    SystemDrive,
    /// Each of `program_files`.
    ProgramFiles,
    Users,
    /// Each of `cloud`.
    Cloud,
    /// `xdg_cache`, else `~/.cache` (Linux only).
    XdgCache,
    /// The root of the file system (Unix only).
    FsRoot,
    /// The override, else the tool's default for the OS.
    NugetHttp,
    PipCache,
    NpmCache,
    CargoHome,
    GradleHome,
    GoCache,
}

impl At {
    /// The component lists this entry stands for; empty when the folder is unknown.
    pub(crate) fn bases<'a>(self, os: Os, k: &'a Known) -> Vec<Vec<&'a str>> {
        let one = |s: &'a str| components(os, s);
        let under = |base: &'a str, extra: &[&'a str]| {
            let mut c = components(os, base);
            if !c.is_empty() {
                c.extend_from_slice(extra);
            }
            c
        };
        let or = |over: &'a Option<String>, default: Vec<&'a str>| match over {
            Some(s) => one(s),
            None => default,
        };
        let win = os == Os::Windows;
        let cache = |name: &'static str| match os {
            Os::Windows => under(&k.local, &[name]),
            Os::Mac => under(&k.home, &["Library", "Caches", name]),
            Os::Linux => {
                let mut c = At::XdgCache.bases(os, k).pop().unwrap_or_default();
                if !c.is_empty() {
                    c.push(name);
                }
                c
            }
        };
        let lists = match self {
            At::Home => vec![one(&k.home)],
            At::Local => vec![one(&k.local)],
            At::LocalLow => vec![one(&k.local_low)],
            At::Roaming => vec![one(&k.roaming)],
            At::Temp => vec![one(&k.temp)],
            At::SystemRoot => vec![one(&k.system_root)],
            At::ProgramData => vec![one(&k.program_data)],
            At::SystemDrive => vec![one(&k.system_drive)],
            At::ProgramFiles => k.program_files.iter().map(|s| one(s)).collect(),
            At::Users => match &k.users {
                Some(s) => vec![one(s)],
                // The folder holding the own profile, if it is the usual one: never the root
                // of the file system or of a drive (`/root`, `C:\u`), nor `/var` (`/var/root`).
                None => {
                    let mut c = one(&k.home);
                    c.pop();
                    let usual = match os {
                        Os::Windows => c.len() >= 2,
                        Os::Linux => c == ["home"],
                        Os::Mac => c == ["Users"],
                    };
                    vec![if usual { c } else { vec![] }]
                }
            },
            At::Cloud => k.cloud.iter().map(|s| one(s)).collect(),
            At::XdgCache => match (&k.xdg_cache, os) {
                (Some(s), Os::Linux) => vec![one(s)],
                (None, Os::Linux) => vec![under(&k.home, &[".cache"])],
                _ => vec![],
            },
            At::FsRoot => return if win { vec![] } else { vec![vec![]] },
            At::NugetHttp => vec![or(
                &k.env.nuget_http,
                if win {
                    under(&k.local, &["NuGet", "v3-cache"])
                } else {
                    under(&k.home, &[".local", "share", "NuGet", "v3-cache"])
                },
            )],
            At::PipCache => vec![or(
                &k.env.pip_cache,
                if win {
                    under(&k.local, &["pip", "Cache"])
                } else {
                    cache("pip")
                },
            )],
            At::NpmCache => vec![or(
                &k.env.npm_cache,
                if win {
                    under(&k.local, &["npm-cache"])
                } else {
                    under(&k.home, &[".npm"])
                },
            )],
            At::CargoHome => vec![or(&k.env.cargo_home, under(&k.home, &[".cargo"]))],
            At::GradleHome => vec![or(&k.env.gradle_home, under(&k.home, &[".gradle"]))],
            At::GoCache => vec![or(&k.env.go_cache, cache("go-build"))],
        };
        lists.into_iter().filter(|c| !c.is_empty()).collect()
    }
}

/// The path of node `id` written by the rules of `os`: the root's own path, then the names below
/// it joined with `\` on Windows and `/` elsewhere, so a table gives the same text on every host.
pub(crate) fn node_path(tree: &Tree, id: u32, os: Os) -> String {
    let sep = if os == Os::Windows { '\\' } else { '/' };
    let mut names = Vec::new();
    let mut at = id;
    while at != NO_PARENT {
        names.push(tree.name(at));
        at = tree.node(at).parent;
    }
    let mut out = String::new();
    for name in names.iter().rev() {
        if !out.is_empty() && !out.ends_with(['\\', '/']) {
            out.push(sep);
        }
        out.push_str(name);
    }
    out
}

/// The components of a path by the rules of `os`. On Windows the `\\?\` and `\\?\UNC\`
/// prefixes are dropped, so canonical and plain paths compare equal.
pub(crate) fn components(os: Os, path: &str) -> Vec<&str> {
    if os != Os::Windows {
        return path.split('/').filter(|s| !s.is_empty()).collect();
    }
    let mut parts: Vec<&str> = path.split(['\\', '/']).filter(|s| !s.is_empty()).collect();
    if matches!(parts.first(), Some(&("?" | "."))) {
        parts.remove(0);
        if parts.first().is_some_and(|p| p.eq_ignore_ascii_case("UNC")) {
            parts.remove(0);
        }
    }
    parts
}

/// Whether `name` fits `mask` (`*` any run, `?` one character); `fold` ignores case.
pub(crate) fn fits(mask: &str, name: &str, fold: bool) -> bool {
    // An ASCII mask compares byte by byte (other bytes never equal its letters), unless a `?`
    // has to stand for one character of a non-ASCII name.
    if !mask.is_ascii() || (!name.is_ascii() && mask.contains('?')) {
        let chars = |s: &str| -> Vec<char> {
            if fold {
                s.to_lowercase().chars().collect()
            } else {
                s.chars().collect()
            }
        };
        return glob(&chars(mask), &chars(name), ('*', '?'), |a, b| a == b);
    }
    let same = |a: &u8, b: &u8| {
        if fold {
            a.eq_ignore_ascii_case(b)
        } else {
            a == b
        }
    };
    let eq = |a: &[u8], b: &[u8]| a.len() == b.len() && a.iter().zip(b).all(|(x, y)| same(x, y));
    let (m, n) = (mask.as_bytes(), name.as_bytes());
    // Most masks are a plain name or `*.ext`: compare those without the general walk.
    match m.iter().rposition(|&c| c == b'*' || c == b'?') {
        None => eq(m, n),
        Some(0) if m[0] == b'*' => {
            n.len() >= m.len() - 1 && eq(&m[1..], &n[n.len() + 1 - m.len()..])
        }
        _ => glob(m, n, (b'*', b'?'), same),
    }
}
