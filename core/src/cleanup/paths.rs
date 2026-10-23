//! Known folders as component lists, and matching those lists against node names.

use super::Os;
use crate::tree::glob;

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
    /// The folder holding every user's profile (`C:\Users`, `/home`, `/Users`).
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
            At::Users => k.users.iter().map(|s| one(s)).collect(),
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

/// What a pattern means for the node it ends at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Hit {
    /// The node is a candidate of rule `n`.
    Rule(u32),
    /// The node and its subtree are never touched.
    Never,
    /// Cancels a `Never` ending at the same node (`%SystemRoot%\Temp`).
    Open,
    /// "Anywhere" rules skip the node and its subtree.
    Zone,
    /// Cancels a `Zone` ending at the same node (the user's own profile in `Users`).
    ZoneOpen,
}

/// A full component list from the file-system root.
pub(crate) struct Pattern<'a> {
    pub comps: Vec<&'a str>,
    pub hit: Hit,
}

/// Adds one pattern per base of `at`: the base, then `path`, then `last` if any.
pub(crate) fn add<'a>(
    out: &mut Vec<Pattern<'a>>,
    (os, known): (Os, &'a Known),
    (at, path, last): (At, &'a [&'a str], Option<&'a str>),
    hit: Hit,
) {
    for mut comps in at.bases(os, known) {
        comps.extend_from_slice(path);
        comps.extend(last);
        out.push(Pattern { comps, hit });
    }
}

/// Partial matches: (pattern, components matched so far).
pub(crate) type State = Vec<(u32, u8)>;

/// Feeds one name to every partial match; the result holds the ones that still fit, including
/// those that end at this name.
pub(crate) fn step(patterns: &[Pattern], state: &[(u32, u8)], name: &str, fold: bool) -> State {
    state
        .iter()
        .filter_map(|&(p, m)| {
            let comps = &patterns[p as usize].comps;
            let fit = (m as usize) < comps.len() && fits(comps[m as usize], name, fold);
            fit.then_some((p, m + 1))
        })
        .collect()
}

/// The hits of the patterns that end at the node `state` was made for.
pub(crate) fn ended<'s>(
    patterns: &'s [Pattern],
    state: &'s [(u32, u8)],
) -> impl Iterator<Item = Hit> + 's {
    state
        .iter()
        .filter(|&&(p, m)| patterns[p as usize].comps.len() == m as usize)
        .map(|&(p, _)| patterns[p as usize].hit)
}

/// Whether the node `state` was made for is never touched (and not opened again).
pub(crate) fn is_never(patterns: &[Pattern], state: &[(u32, u8)]) -> bool {
    ended(patterns, state).any(|h| h == Hit::Never)
        && !ended(patterns, state).any(|h| h == Hit::Open)
}
