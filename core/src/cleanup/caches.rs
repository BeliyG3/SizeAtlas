//! Windows caches (rules 4–7): the internet cache, shader caches of Windows and the GPU drivers,
//! browser caches and the caches of Electron apps and Steam. Browsers and apps are offered only
//! while they are closed.

use super::paths::At;
use super::rules::{Dirs, dirs};
use super::{App, Marker, Mode, Place, Reason, Rule, Target};

const fn app(name: &'static str, exes: &'static [&'static str]) -> App {
    App {
        name,
        exes,
        cmds: &[],
    }
}

const CHROME: App = app("Google Chrome", &["chrome.exe"]);
const EDGE: App = app("Microsoft Edge", &["msedge.exe"]);
const YANDEX: App = app("Yandex Browser", &["browser.exe"]);
const BRAVE: App = app("Brave", &["brave.exe"]);
const VIVALDI: App = app("Vivaldi", &["vivaldi.exe"]);
const OPERA: App = app("Opera", &["opera*.exe"]);
const FIREFOX: App = app("Firefox", &["firefox.exe"]);
const DISCORD: App = app("Discord", &["discord*.exe"]);
const SLACK: App = app("Slack", &["slack.exe"]);
const STEAM: App = app("Steam", &["steam.exe", "steamwebhelper.exe"]);
const VSCODE: App = app("Visual Studio Code", &["code.exe"]);

/// Profiles of Chromium browsers below `%LOCALAPPDATA%`: `...\User Data\<profile>`.
const CHROMIUM: &[(&App, &[&str])] = &[
    (&CHROME, &["Google", "Chrome", "User Data", "*"]),
    (&EDGE, &["Microsoft", "Edge", "User Data", "*"]),
    (&YANDEX, &["Yandex", "YandexBrowser", "User Data", "*"]),
    (
        &BRAVE,
        &["BraveSoftware", "Brave-Browser", "User Data", "*"],
    ),
    (&VIVALDI, &["Vivaldi", "User Data", "*"]),
];
/// In a profile: a folder next to `Preferences`.
const PROFILE: &[&str] = &[
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnWebGPUCache",
    "DawnGraphiteCache",
];
/// In `User Data`: a folder next to `Local State`.
const USER_DATA: &[&str] = &["ShaderCache", "GrShaderCache", "GraphiteDawnCache"];

const CODE_GPU: &[&str] = &["Code Cache", "GPUCache"];
const ALL_THREE: &[&str] = &["Cache", "Code Cache", "GPUCache"];
const SHADER: Reason = Reason::ShaderCache;
const BROWSER: Reason = Reason::BrowserCache;
const APP: Reason = Reason::AppCache;

const GROUPS: &[Dirs] = &[
    // Rule 5. The reason's text suggests capping the cache size in the driver's panel.
    (None, At::Local, &[], &["D3DSCache"], SHADER),
    (
        None,
        At::Local,
        &["NVIDIA"],
        &["DXCache", "GLCache"],
        SHADER,
    ),
    (
        None,
        At::LocalLow,
        &["NVIDIA", "PerDriverVersion"],
        &["DXCache", "GLCache"],
        SHADER,
    ),
    (None, At::Roaming, &["NVIDIA"], &["ComputeCache"], SHADER),
    (None, At::Local, &["AMD"], &["DxCache", "GLCache"], SHADER),
    (None, At::Local, &["Intel"], &["ShaderCache"], SHADER),
    // Rule 6: Opera keeps `Cache` in Local and the rest in Roaming; Firefox only `cache2`.
    (Some(&OPERA), At::Local, OPERA_DIR, &["Cache"], BROWSER),
    (Some(&OPERA), At::Roaming, OPERA_DIR, CODE_GPU, BROWSER),
    (Some(&OPERA), At::Roaming, OPERA_DEFAULT, CODE_GPU, BROWSER),
    (
        Some(&FIREFOX),
        At::Local,
        FIREFOX_PROFILE,
        &["cache2"],
        BROWSER,
    ),
    // Rule 7: Discord in Roaming only (Local holds the program); never all of `htmlcache`,
    // which holds cookies.
    (Some(&DISCORD), At::Roaming, &["discord*"], CODE_GPU, APP),
    (Some(&SLACK), At::Roaming, &["Slack"], ALL_THREE, APP),
    (
        Some(&STEAM),
        At::Local,
        &["Steam", "htmlcache"],
        ALL_THREE,
        APP,
    ),
    (Some(&VSCODE), At::Roaming, &["Code"], VSCODE_DIRS, APP),
];
const OPERA_DIR: &[&str] = &["Opera Software", "Opera*"];
const OPERA_DEFAULT: &[&str] = &["Opera Software", "Opera*", "Default"];
const FIREFOX_PROFILE: &[&str] = &["Mozilla", "Firefox", "Profiles", "*"];
const VSCODE_DIRS: &[&str] = &["Cache", "Code Cache", "GPUCache", "CachedData"];

/// Everything in it but `Content.Outlook` and `Content.MSO` (never places): edited
/// attachments may have their only copy there.
const INETCACHE: Rule = Rule::new(
    Place::At(At::Local, &["Microsoft", "Windows", "INetCache"]),
    Target::Any("*"),
    Mode::Cleanup,
    Reason::WindowsCache,
);

/// Discord's HTTP cache also holds the favourite GIFs.
const DISCORD_CACHE: Rule = Rule {
    app: Some(&DISCORD),
    ..Rule::new(
        Place::At(At::Roaming, &["discord*"]),
        Target::Dir("Cache"),
        Mode::Review,
        Reason::DiscordCache,
    )
};

fn chromium() -> impl Iterator<Item = Rule> {
    CHROMIUM.iter().flat_map(|&(app, profile)| {
        let user_data = &profile[..profile.len() - 1];
        let rule = move |path, name, next_to| Rule {
            app: Some(app),
            marker: Some(Marker::Sibling(next_to)),
            ..Rule::new(
                Place::At(At::Local, path),
                Target::Dir(name),
                Mode::Cleanup,
                BROWSER,
            )
        };
        let profiles = PROFILE
            .iter()
            .map(move |&n| rule(profile, n, "Preferences"));
        profiles.chain(
            USER_DATA
                .iter()
                .map(move |&n| rule(user_data, n, "Local State")),
        )
    })
}

/// Rules 4–7.
pub(crate) fn windows() -> impl Iterator<Item = Rule> {
    [INETCACHE, DISCORD_CACHE]
        .into_iter()
        .chain(dirs(GROUPS))
        .chain(chromium())
}
