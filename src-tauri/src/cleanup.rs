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

/// The context of this machine, read fresh: processes are listed on every call.
pub fn real_context(root: &Path) -> Context {
    Context {
        os: Os::current(),
        known: known(),
        running: running(),
        reboot_pending: reboot_pending(),
        recyclable: can_recycle(root, 0),
    }
}

/// The long, canonical form of an existing folder (8.3 names expanded, no `\\?\`); `None` when
/// it cannot be resolved or is not valid Unicode, which the rules read as "absent".
fn folder(path: impl AsRef<Path>) -> Option<String> {
    let path = path.as_ref();
    if path.as_os_str().is_empty() {
        return None;
    }
    dunce::canonicalize(path)
        .ok()?
        .into_os_string()
        .into_string()
        .ok()
}

/// The folder an environment variable names.
fn var(name: &str) -> Option<String> {
    folder(env::var_os(name)?)
}

/// `folder` below `home`, or `None`.
fn under(home: &str, rel: &str) -> Option<String> {
    (!home.is_empty()).then(|| folder(Path::new(home).join(rel)))?
}

/// The folder holding the user's profile.
fn parent(home: &str) -> Option<String> {
    let parent = Path::new(home).parent()?.to_str()?;
    (!parent.is_empty()).then(|| parent.to_owned())
}

/// Cloud sync folders: those the environment names, and the usual ones in the profile.
fn clouds(home: &str, vars: &[&str]) -> Vec<String> {
    let named = vars.iter().filter_map(|v| var(v));
    let usual = ["Dropbox", "iCloudDrive", "Google Drive"].map(|n| under(home, n));
    let mut out: Vec<String> = Vec::new();
    for path in named.chain(usual.into_iter().flatten()) {
        if !out.contains(&path) {
            out.push(path);
        }
    }
    out
}

/// Cache folders the tools' environment variables move.
fn overrides() -> Overrides {
    Overrides {
        nuget_http: var("NUGET_HTTP_CACHE_PATH"),
        pip_cache: var("PIP_CACHE_DIR"),
        npm_cache: var("npm_config_cache").or_else(|| var("NPM_CONFIG_CACHE")),
        cargo_home: var("CARGO_HOME"),
        gradle_home: var("GRADLE_USER_HOME"),
        go_cache: var("GOCACHE"),
    }
}

#[cfg(windows)]
fn known() -> Known {
    let get = |name: &str| var(name).unwrap_or_default();
    let home = get("USERPROFILE");
    let mut program_files: Vec<String> = Vec::new();
    for name in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(path) = var(name).filter(|p| !program_files.contains(p)) {
            program_files.push(path);
        }
    }
    let drive = env::var("SystemDrive").ok().and_then(|d| folder(d + "\\"));
    Known {
        local: get("LOCALAPPDATA"),
        local_low: under(&home, r"AppData\LocalLow").unwrap_or_default(),
        roaming: get("APPDATA"),
        temp: get("TEMP"),
        system_root: get("SystemRoot"),
        program_data: get("ProgramData"),
        system_drive: drive.unwrap_or_default(),
        xdg_cache: None,
        program_files,
        users: parent(&home),
        cloud: clouds(
            &home,
            &["OneDrive", "OneDriveConsumer", "OneDriveCommercial"],
        ),
        env: overrides(),
        home,
    }
}

#[cfg(not(windows))]
fn known() -> Known {
    let home = var("HOME").unwrap_or_default();
    Known {
        users: parent(&home),
        xdg_cache: var("XDG_CACHE_HOME"),
        cloud: clouds(&home, &[]),
        env: overrides(),
        home,
        ..Known::default()
    }
}

/// Every process with its lower-case executable name and command line.
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
mod tests {
    use super::*;

    /// The only test that reads this machine: it checks nothing about it.
    #[test]
    fn the_real_context_reads_without_failing() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = real_context(dir.path());
        assert_eq!(ctx.os, Os::current());
        assert!(!ctx.known.home.is_empty());
        assert!(!ctx.running.is_empty(), "this test runs in a process");
    }

    #[test]
    fn a_missing_or_empty_folder_is_absent() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(folder(""), None);
        assert_eq!(folder(dir.path().join("missing")), None);
        assert_eq!(under("", "x"), None);
        let found = folder(dir.path()).unwrap();
        assert!(!found.starts_with(r"\\?\"), "{found}");
        assert_eq!(parent(&found), folder(dir.path().parent().unwrap()));
    }
}
