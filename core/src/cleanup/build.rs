//! Builders shared by the rule tables of every OS, and the package rules they have in common.

use super::paths::At;
use super::{App, Marker, Mode, Place, Reason, Rule, Target};

pub(crate) const fn app(
    name: &'static str,
    exes: &'static [&'static str],
    cmds: &'static [(&'static str, &'static str)],
) -> App {
    App { name, exes, cmds }
}

/// Folders below one place: (app that must be closed, known folder, path, names, reason).
pub(crate) type Dirs = (
    Option<&'static App>,
    At,
    &'static [&'static str],
    &'static [&'static str],
    Reason,
);

/// One Cleanup rule per folder name of each group.
pub(crate) fn dirs(groups: &'static [Dirs]) -> impl Iterator<Item = Rule> {
    groups.iter().flat_map(|&(app, at, path, names, reason)| {
        names.iter().map(move |&name| Rule {
            app,
            ..Rule::new(
                Place::At(at, path),
                Target::Dir(name),
                Mode::Cleanup,
                reason,
            )
        })
    })
}

/// A package cache, offered while its tool is closed, with the tool's own clean-up command.
pub(crate) const fn package(
    app: &'static App,
    place: Place,
    target: Target,
    command: Option<&'static str>,
) -> Rule {
    Rule {
        app: Some(app),
        command,
        ..Rule::new(place, target, Mode::Cleanup, Reason::PackageCache)
    }
}

/// npm's content cache (never `_npx`: packages of running npx tools), pip's HTTP and wheel
/// caches (by name, so an odd `PIP_CACHE_DIR` offers nothing else), Cargo's downloaded
/// `.crate` archives (never `registry/src`, `git`, `bin`).
pub(crate) fn shared(npm: &'static App, pip: &'static App, cargo: &'static App) -> [Rule; 5] {
    let purge = Some("pip cache purge");
    let pip_dir = |name| package(pip, Place::At(At::PipCache, &[]), Target::Dir(name), purge);
    [
        package(
            npm,
            Place::At(At::NpmCache, &[]),
            Target::Dir("_cacache"),
            Some("npm cache clean --force"),
        ),
        pip_dir("http"),
        pip_dir("http-v2"),
        pip_dir("wheels"),
        package(
            cargo,
            Place::At(At::CargoHome, &["registry", "cache", "*"]),
            Target::File("*.crate"),
            None,
        ),
    ]
}

/// The Go build cache (`GOCACHE` or the default) itself, recognised by the `trim.txt` Go writes
/// into it (rare elsewhere, unlike a `README`), so an odd `GOCACHE` offers nothing.
pub(crate) const fn go(app: &'static App) -> Rule {
    Rule {
        marker: Some(Marker::Inside("trim.txt")),
        ..package(
            app,
            Place::Is(At::GoCache),
            Target::Dir("*"),
            Some("go clean -cache"),
        )
    }
}
