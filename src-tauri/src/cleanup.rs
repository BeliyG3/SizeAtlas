//! What the clean-up lists depend on besides the tree: the known folders of the user and the
//! system, the running processes, a pending restart and whether the volume has a recycle bin.

use std::env;
use std::path::Path;
use std::sync::Arc;

use sizeatlas_core::cleanup::{Context, Known, Os, Overrides, Running};
use sizeatlas_core::{can_recycle, reboot_pending};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// Builds the context for the tree with this root. [`crate::state::AppState`] holds one; tests
/// inject their own, since the real one points the rules at this machine's folders.
pub type ContextFn = Arc<dyn Fn(&Path) -> Context + Send + Sync>;

/// The context of `AppState::default()`: this machine's.
#[cfg(not(test))]
pub fn default_context() -> ContextFn {
    Arc::new(real_context)
}

/// The context of `AppState::default()` in tests: nothing known and no recycle bin, so the
/// clean-up modes list nothing. A test that needs rows injects its own context.
#[cfg(test)]
pub fn default_context() -> ContextFn {
    Arc::new(|_: &Path| Context {
        os: Os::current(),
        known: Known::default(),
        running: Vec::new(),
        reboot_pending: false,
        recyclable: false,
    })
}

/// The context of this machine, read fresh: processes are listed on every call.
pub fn real_context(root: &Path) -> Context {
    let var = |name: &str| env::var(name).ok().filter(|v| !v.is_empty());
    Context {
        os: Os::current(),
        known: known(
            Os::current(),
            &Env {
                var: &var,
                dir: &folder,
            },
        ),
        running: running(),
        reboot_pending: reboot_pending(),
        recyclable: can_recycle(root, 0),
    }
}

/// The long, canonical form of an existing folder (8.3 names expanded, no `\\?\`); `None` when
/// it cannot be resolved or is not valid Unicode, which the rules read as "absent".
fn folder(path: &Path) -> Option<String> {
    if path.as_os_str().is_empty() {
        return None;
    }
    dunce::canonicalize(path)
        .ok()?
        .into_os_string()
        .into_string()
        .ok()
}

/// Where the known folders come from: the value of an environment variable, and the form of a
/// folder the rules compare (`None` = absent). Tests pass a map and plain strings.
struct Env<'a> {
    var: &'a dyn Fn(&str) -> Option<String>,
    dir: &'a dyn Fn(&Path) -> Option<String>,
}

impl Env<'_> {
    /// The folder a variable names.
    fn folder(&self, name: &str) -> Option<String> {
        (self.dir)(Path::new(&(self.var)(name)?))
    }

    /// A folder below `base`.
    fn under(&self, base: &str, rel: &str) -> Option<String> {
        (!base.is_empty()).then(|| (self.dir)(&Path::new(base).join(rel)))?
    }

    /// Cloud sync folders: those the variables name, and the usual ones in the profile.
    fn clouds(&self, home: &str, vars: &[&str]) -> Vec<String> {
        let named = vars.iter().filter_map(|v| self.folder(v));
        let usual = ["Dropbox", "iCloudDrive", "Google Drive"].map(|n| self.under(home, n));
        let mut out: Vec<String> = Vec::new();
        for path in named.chain(usual.into_iter().flatten()) {
            if !out.contains(&path) {
                out.push(path);
            }
        }
        out
    }

    /// Cache folders the tools' environment variables move.
    fn overrides(&self) -> Overrides {
        Overrides {
            nuget_http: self.folder("NUGET_HTTP_CACHE_PATH"),
            pip_cache: self.folder("PIP_CACHE_DIR"),
            npm_cache: self
                .folder("npm_config_cache")
                .or_else(|| self.folder("NPM_CONFIG_CACHE")),
            cargo_home: self.folder("CARGO_HOME"),
            gradle_home: self.folder("GRADLE_USER_HOME"),
            go_cache: self.folder("GOCACHE"),
        }
    }
}

/// The parent folder of `path`.
fn parent(path: &str) -> Option<String> {
    let parent = Path::new(path).parent()?.to_str()?;
    (!parent.is_empty()).then(|| parent.to_owned())
}

/// The known folders of `os` read from `env`.
fn known(os: Os, env: &Env) -> Known {
    if os != Os::Windows {
        let home = env.folder("HOME").unwrap_or_default();
        return Known {
            // The core takes the parent of home only when it is `/home` or `/Users`: never
            // `/` for `/root`, nor `/var` for `/var/root`.
            users: None,
            xdg_cache: env.folder("XDG_CACHE_HOME"),
            cloud: env.clouds(&home, &[]),
            env: env.overrides(),
            home,
            ..Known::default()
        };
    }
    let get = |name: &str| env.folder(name).unwrap_or_default();
    let home = get("USERPROFILE");
    let mut program_files: Vec<String> = Vec::new();
    for name in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(path) = env.folder(name).filter(|p| !program_files.contains(p)) {
            program_files.push(path);
        }
    }
    let drive = (env.var)("SystemDrive").and_then(|d| (env.dir)(Path::new(&(d + "\\"))));
    Known {
        local: get("LOCALAPPDATA"),
        local_low: env.under(&home, r"AppData\LocalLow").unwrap_or_default(),
        roaming: get("APPDATA"),
        temp: get("TEMP"),
        system_root: get("SystemRoot"),
        program_data: get("ProgramData"),
        system_drive: drive.unwrap_or_default(),
        xdg_cache: None,
        program_files,
        // `%PUBLIC%` lies in the profiles folder for every account, SYSTEM too, whose own home
        // is `%SystemRoot%\System32\config\systemprofile`. Without it, an empty folder: unknown,
        // so "anywhere" rules list nothing.
        users: Some(
            env.folder("PUBLIC")
                .and_then(|p| parent(&p))
                .unwrap_or_default(),
        ),
        cloud: env.clouds(
            &home,
            &["OneDrive", "OneDriveConsumer", "OneDriveCommercial"],
        ),
        env: env.overrides(),
        home,
    }
}

/// Every process with its lower-case executable name and command line. A process running
/// elevated (or protected) while the app is not shows an empty command line, so a tool known by
/// its command line (npm, pip, Gradle) does not count as running then; the delete-time check
/// has the same blind spot.
fn running() -> Vec<Running> {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
    );
    let lower = |s: &std::ffi::OsStr| s.to_string_lossy().to_lowercase();
    system
        .processes()
        .values()
        .map(|p| Running {
            exe: lower(p.name()),
            cmd: p
                .cmd()
                .iter()
                .map(|a| lower(a))
                .collect::<Vec<_>>()
                .join(" "),
        })
        .collect()
}

#[cfg(test)]
mod tests;
