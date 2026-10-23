//! The Windows tables: crash dumps and error reports (rules 2–3), package caches (8), the
//! "anywhere" rules (9 and "Check before deleting") and the info spots. Temp is in `temp`, the
//! caches of Windows, drivers, browsers and apps (4–7) in `caches`.

use std::sync::LazyLock;

use super::build::{app, go, package, shared};
use super::paths::At;
use super::{Age, App, Marker, Mode, Place, Reason, Rule, Spot, SpotKind, Target, caches, temp};

// Tools: npm, pip and Gradle by command line, as `node.exe`, `python.exe` and `java.exe` also
// run other programs all the time (Claude Code, MCP servers, IDEs).
const NPM: App = app(
    "npm",
    &[],
    &[("node.exe", "npm-cli.js"), ("node.exe", "npx-cli.js")],
);
const YARN: App = app("Yarn", &[], &[("node.exe", "yarn.js")]);
const PIP: App = app("pip", &["pip*.exe"], &[("python*.exe", "-m pip")]);
/// `dotnet restore`/`build` fill the HTTP cache too; other `dotnet.exe` (language servers)
/// do not hide it.
const NUGET: App = app(
    "NuGet",
    &["nuget.exe"],
    &[
        ("dotnet.exe", "restore"),
        ("dotnet.exe", "build"),
        ("dotnet.exe", "nuget"),
    ],
);
const CARGO: App = app("Cargo", &["cargo.exe"], &[]);
const GO: App = app("Go", &["go.exe"], &[]);
const GRADLE: App = app("Gradle", &[], &[("java.exe", "org.gradle")]);

/// Dumps per file: older than 14 days in Cleanup, younger ones in Review.
const DUMPS: &[(At, &[&str], &str)] = &[
    (At::SystemRoot, &["Minidump"], "*.dmp"),
    (At::SystemRoot, &[], "MEMORY.DMP"),
    (At::Local, &["CrashDumps"], "*.dmp"),
];
const DUMP_AGE: Age = Age {
    days: 14,
    young: Some((Mode::Review, Reason::CrashDumpRecent)),
};

const ARCHIVE: &[&str] = &["Microsoft", "Windows", "WER", "ReportArchive"];
const QUEUE: &[&str] = &["Microsoft", "Windows", "WER", "ReportQueue"];

/// Report folders, not their containers; queued reports only when older than 7 days.
const REPORTS: &[(At, &[&str], Option<u32>)] = &[
    (At::ProgramData, ARCHIVE, None),
    (At::ProgramData, QUEUE, Some(7)),
    (At::Local, ARCHIVE, None),
    (At::Local, QUEUE, Some(7)),
];

/// Info only: owned by the kernel, Windows Setup, services or the tools themselves.
pub(crate) const SPOTS: &[Spot] = &[
    spot(At::SystemDrive, &["pagefile.sys"], SpotKind::Pagefile),
    spot(At::SystemDrive, &["swapfile.sys"], SpotKind::Pagefile),
    spot(At::SystemDrive, &["hiberfil.sys"], SpotKind::Hiberfil),
    spot(At::SystemDrive, &["Windows.old"], SpotKind::PreviousWindows),
    spot(
        At::SystemDrive,
        &["$WINDOWS.~BT"],
        SpotKind::PreviousWindows,
    ),
    spot(
        At::SystemDrive,
        &["$WINDOWS.~WS"],
        SpotKind::PreviousWindows,
    ),
    spot(At::SystemDrive, &["$WinREAgent"], SpotKind::PreviousWindows),
    spot(At::SystemRoot, UPDATE, SpotKind::WindowsUpdate),
    spot(At::SystemRoot, DELIVERY, SpotKind::DeliveryOptimization),
    spot(
        At::Local,
        &["uv", "cache"],
        SpotKind::ToolStore("uv cache clean"),
    ),
    spot(At::Local, &["pnpm", "store"], SpotKind::ToolStore(PNPM)),
    spot(At::Home, &[".pnpm-store"], SpotKind::ToolStore(PNPM)),
    spot(
        At::Local,
        YARN_BERRY,
        SpotKind::ToolStore("yarn cache clean"),
    ),
];

const UPDATE: &[&str] = &["SoftwareDistribution", "Download"];
const DELIVERY: &[&str] = &[
    "ServiceProfiles",
    "NetworkService",
    "AppData",
    "Local",
    "Microsoft",
    "Windows",
    "DeliveryOptimization",
    "Cache",
];
const PNPM: &str = "pnpm store prune";
const YARN_BERRY: &[&str] = &["Yarn", "Berry", "cache"];

const fn spot(at: At, path: &'static [&'static str], kind: SpotKind) -> Spot {
    Spot { at, path, kind }
}

/// Rules 1–9 and "Check before deleting", in the order they are tried.
pub(crate) static WINDOWS: LazyLock<Vec<Rule>> = LazyLock::new(|| {
    let mut rules = temp::RULES.to_vec();
    rules.extend(DUMPS.iter().map(|&(at, path, name)| Rule {
        age: Some(DUMP_AGE),
        ..Rule::new(
            Place::At(at, path),
            Target::File(name),
            Mode::Cleanup,
            Reason::CrashDump,
        )
    }));
    rules.extend(REPORTS.iter().map(|&(at, path, days)| Rule {
        age: days.map(|days| Age { days, young: None }),
        ..Rule::new(
            Place::At(at, path),
            Target::Dir("*"),
            Mode::Cleanup,
            Reason::ErrorReport,
        )
    }));
    rules.extend(caches::windows());
    rules.extend(shared(&NPM, &PIP, &CARGO));
    rules.extend([
        // Feed folders (`<sha1>$<source>`) of `NUGET_HTTP_CACHE_PATH` or the default, so an
        // odd override offers nothing else; never `.nuget\packages`.
        package(
            &NUGET,
            Place::At(At::NugetHttp, &[]),
            Target::Dir("*$*"),
            Some("dotnet nuget locals http-cache --clear"),
        ),
        // Yarn Classic only: Berry's cache (`Yarn\Berry`) may be the only copy (a spot).
        package(
            &YARN,
            Place::At(At::Local, &["Yarn"]),
            Target::Dir("Cache"),
            Some("yarn cache clean"),
        ),
        go(&GO),
        // Not `jdks` or `wrapper`, which lie next to `caches`.
        Rule {
            app: Some(&GRADLE),
            ..Rule::new(
                Place::At(At::GradleHome, &[]),
                Target::Dir("caches"),
                Mode::Review,
                Reason::GradleCache,
            )
        },
    ]);
    rules.extend(ANYWHERE);
    rules
});

/// Only the outermost, outside the zones, and only with their markers.
const ANYWHERE: [Rule; 4] = [
    Rule {
        marker: Some(Marker::Sibling("package.json")),
        ..Rule::new(
            Place::Anywhere,
            Target::Dir("node_modules"),
            Mode::Review,
            Reason::NodeModules,
        )
    },
    Rule {
        marker: Some(Marker::Inside("pyvenv.cfg")),
        ..Rule::new(
            Place::Anywhere,
            Target::Dir(".venv"),
            Mode::Review,
            Reason::PythonVenv,
        )
    },
    Rule {
        marker: Some(Marker::Inside("pyvenv.cfg")),
        ..Rule::new(
            Place::Anywhere,
            Target::Dir("venv"),
            Mode::Review,
            Reason::PythonVenv,
        )
    },
    // Source-less bytecode is never imported (PEP 3147), so only folders of nothing else.
    Rule {
        marker: Some(Marker::Only(&["*.pyc", "*.pyo"])),
        ..Rule::new(
            Place::Anywhere,
            Target::Dir("__pycache__"),
            Mode::Cleanup,
            Reason::PythonBytecode,
        )
    },
];
