//! The macOS and Linux tables: a fixed list of caches each, not whole cache folders (apps keep
//! state in them). Untested on real hardware.
//!
//! ponytail: Linux `/var/tmp` lists nothing: the spec allows the user's own regular files older
//! than 30 days, but the tree has no owner or file type. Add a rule once the scan records them.
//! `/tmp` is never touched (often tmpfs; systemd cleans it).

use std::sync::LazyLock;

use super::build::{Dirs, app, dirs, go, package, shared};
use super::paths::At;
use super::{Age, App, Mode, Place, Reason, Rule, Target};

const NPM: App = app(
    "npm",
    &["npm", "npx"],
    &[("node", "npm-cli.js"), ("node", "npx-cli.js")],
);
const PIP: App = app("pip", &["pip", "pip3", "pip3.*"], &[("python*", "-m pip")]);
const CARGO: App = app("Cargo", &["cargo"], &[]);
const GO: App = app("Go", &["go"], &[]);
const BREW: App = app("Homebrew", &["brew"], &[("*", "homebrew/brew.")]);
const XCODE: App = app("Xcode", &["xcode", "xcodebuild"], &[]);
const VSCODE: App = app(
    "Visual Studio Code",
    &["shipit"],
    &[("*", "visual studio code.app")],
);
const MAC_CHROME: App = app("Google Chrome", &["google chrome*"], &[]);
const MAC_FIREFOX: App = app("Firefox", &["firefox"], &[]);
const FIREFOX: App = app("Firefox", &["firefox*"], &[]);
const CHROME: App = app("Google Chrome", &["chrome", "google-chrome*"], &[]);
const CHROMIUM: App = app("Chromium", &["chromium*"], &[]);
const BRAVE: App = app("Brave", &["brave*"], &[]);
const EDGE: App = app("Microsoft Edge", &["msedge", "microsoft-edge*"], &[]);
const VIVALDI: App = app("Vivaldi", &["vivaldi*"], &[]);

const CACHES: &[&str] = &["Library", "Caches"];
const BROWSER: Reason = Reason::BrowserCache;

const MAC_GROUPS: &[Dirs] = &[
    (
        Some(&VSCODE),
        At::Home,
        CACHES,
        &["com.microsoft.VSCode.ShipIt"],
        Reason::AppCache,
    ),
    (
        Some(&MAC_CHROME),
        At::Home,
        &["Library", "Caches", "Google", "Chrome", "*"],
        &["Cache", "Code Cache"],
        BROWSER,
    ),
    (
        Some(&MAC_FIREFOX),
        At::Home,
        &["Library", "Caches", "Firefox", "Profiles", "*"],
        &["cache2"],
        BROWSER,
    ),
];

/// `~/Library/Caches/com.apple.*` and the rest of `~/Library` are never places.
pub(crate) static MAC: LazyLock<Vec<Rule>> = LazyLock::new(|| {
    let mut rules = shared(&NPM, &PIP, &CARGO).to_vec();
    rules.push(go(&GO));
    rules.push(package(
        &BREW,
        Place::At(At::Home, CACHES),
        Target::Dir("Homebrew"),
        Some("brew cleanup --prune=all"),
    ));
    rules.extend(dirs(MAC_GROUPS));
    rules.push(Rule {
        age: Some(Age {
            days: 7,
            young: None,
        }),
        ..Rule::new(
            Place::At(At::Home, &["Library", "Logs", "DiagnosticReports"]),
            Target::Any("*"),
            Mode::Cleanup,
            Reason::ErrorReport,
        )
    });
    // Never `Archives`, which lies next to it.
    rules.push(Rule {
        app: Some(&XCODE),
        ..Rule::new(
            Place::At(At::Home, &["Library", "Developer", "Xcode"]),
            Target::Dir("DerivedData"),
            Mode::Review,
            Reason::XcodeDerived,
        )
    });
    rules
});

/// Chromium browsers keep only caches below `XDG_CACHE_HOME` (data is in `~/.config`).
const CHROMIUM_DIRS: &[&str] = &["Cache", "Code Cache", "GPUCache"];

const LINUX_GROUPS: &[Dirs] = &[
    (None, At::XdgCache, &[], &["thumbnails"], Reason::AppCache),
    (
        None,
        At::XdgCache,
        &[],
        &["mesa_shader_cache", "mesa_shader_cache_db"],
        Reason::ShaderCache,
    ),
    (
        Some(&FIREFOX),
        At::XdgCache,
        &["mozilla", "firefox", "*"],
        &["cache2"],
        BROWSER,
    ),
    (
        Some(&CHROME),
        At::XdgCache,
        &["google-chrome", "*"],
        CHROMIUM_DIRS,
        BROWSER,
    ),
    (
        Some(&CHROMIUM),
        At::XdgCache,
        &["chromium", "*"],
        CHROMIUM_DIRS,
        BROWSER,
    ),
    (
        Some(&BRAVE),
        At::XdgCache,
        &["BraveSoftware", "Brave-Browser", "*"],
        CHROMIUM_DIRS,
        BROWSER,
    ),
    (
        Some(&EDGE),
        At::XdgCache,
        &["microsoft-edge", "*"],
        CHROMIUM_DIRS,
        BROWSER,
    ),
    (
        Some(&VIVALDI),
        At::XdgCache,
        &["vivaldi", "*"],
        CHROMIUM_DIRS,
        BROWSER,
    ),
];

pub(crate) static LINUX: LazyLock<Vec<Rule>> = LazyLock::new(|| {
    let mut rules = shared(&NPM, &PIP, &CARGO).to_vec();
    rules.extend(dirs(LINUX_GROUPS));
    rules
});
