//! The Windows package rules (8), the "anywhere" rules (9, "Check before deleting") and the
//! tools that count as running by their command line.

use super::tests::{build, it, listed, local, rel, rows, sorted, win};
use super::*;

#[test]
fn npm_offers_its_content_cache_but_never_npx() {
    let (cleanup, _) = rows(
        vec![
            it(local(r"npm-cache\_cacache\index-v5\f")),
            it(local(r"npm-cache\_npx\1a2b\node_modules\server\index.js")),
            it(local(r"npm-cache\_logs\debug.log")),
        ],
        &win(),
    );
    assert_eq!(cleanup, [local(r"npm-cache\_cacache")]);
}

/// A NuGet HTTP-cache feed folder, named `<sha1>$<source>`.
const FEED: &str = r"670c1461c29885f9aa22c281d8b7da90845b38e4$ps_api.nuget.org_v3_index.json";

#[test]
fn nuget_offers_its_feed_folders_where_an_override_puts_them() {
    let items = || {
        vec![
            it(format!(r"caches\nuget-http\{FEED}\list_a.dat")),
            it(local(&format!(r"NuGet\v3-cache\{FEED}\list_a.dat"))),
            it(local(r"NuGet\v3-cache\notes\f")),
        ]
    };
    assert_eq!(
        rows(items(), &win()).0,
        [local(&format!(r"NuGet\v3-cache\{FEED}"))]
    );
    let mut ctx = win();
    ctx.known.env.nuget_http = Some(r"C:\caches\nuget-http".into());
    assert_eq!(
        rows(items(), &ctx).0,
        [format!(r"caches\nuget-http\{FEED}")]
    );
}

#[test]
fn a_go_cache_is_recognised_by_its_trim_file() {
    let mut ctx = win();
    ctx.known.env.go_cache = Some(r"C:\work\gocache".into());
    let without = vec![it(r"work\gocache\00\f"), it(r"work\gocache\README")];
    assert_eq!(rows(without, &ctx), (vec![], vec![]));
    let with = vec![it(r"work\gocache\00\f"), it(r"work\gocache\trim.txt")];
    assert_eq!(rows(with, &ctx).0, [r"work\gocache"]);
}

#[test]
fn an_override_naming_a_broad_folder_offers_nothing_of_it() {
    let mut ctx = win();
    let dev = || Some(r"C:\Dev".to_string());
    let env = &mut ctx.known.env;
    (env.nuget_http, env.go_cache, env.pip_cache) = (dev(), dev(), dev());
    let items = vec![
        it(r"Dev\.git\HEAD"),
        it(r"Dev\README"),
        it(r"Dev\proj\src\Program.cs"),
        it(r"Dev\proj\bin\Debug\app.dll"),
        it(local(r"npm-cache\_cacache\f")),
    ];
    assert_eq!(
        rows(items, &ctx),
        (vec![local(r"npm-cache\_cacache")], vec![])
    );
}

#[test]
fn place_overrides_win_over_the_default_places() {
    type Set = fn(&mut Overrides, String);
    let cases: [(Set, &str, &str); 4] = [
        (
            |e, p| e.pip_cache = Some(p),
            r"o\pip\wheels\f",
            r"o\pip\wheels",
        ),
        (
            |e, p| e.npm_cache = Some(p),
            r"o\npm\_cacache\f",
            r"o\npm\_cacache",
        ),
        (
            |e, p| e.cargo_home = Some(p),
            r"o\cargo\registry\cache\i\a.crate",
            r"o\cargo\registry\cache\i\a.crate",
        ),
        (
            |e, p| e.gradle_home = Some(p),
            r"o\gradle\caches\f",
            r"o\gradle\caches",
        ),
    ];
    for (set, item, row) in cases {
        let mut ctx = win();
        let base = item.split('\\').take(2).collect::<Vec<_>>().join("\\");
        set(&mut ctx.known.env, format!(r"C:\{base}"));
        // The default places of all four tools: only the overridden one moves away.
        let items = vec![
            it(item),
            it(local(r"pip\Cache\wheels\f")),
            it(local(r"npm-cache\_cacache\f")),
            it(r"Users\u\.cargo\registry\cache\i\b.crate"),
            it(r"Users\u\.gradle\caches\f"),
        ];
        let (cleanup, review) = rows(items, &ctx);
        let all = [cleanup, review].concat();
        assert_eq!(all.len(), 4, "{item}: {all:?}");
        assert!(all.iter().any(|r| r == row), "{item}: {all:?}");
    }
}

#[test]
fn package_caches_offer_only_what_the_tool_rebuilds() {
    let items = vec![
        it(local(r"pip\Cache\http-v2\a\f")),
        it(local(r"pip\Cache\wheels\a\f")),
        it(r"Users\u\.cargo\registry\cache\index.crates.io-6f17d22bba15001f\serde-1.0.0.crate"),
        it(r"Users\u\.cargo\registry\src\index.crates.io-6f17d22bba15001f\serde\lib.rs"),
        it(r"Users\u\.cargo\bin\cargo.exe"),
        it(local(r"Yarn\Cache\v6\npm-a\f")),
        it(local(r"go-build\trim.txt")),
        it(local(r"go-build\00\f")),
        it(r"Users\u\.gradle\caches\modules-2\f"),
        it(r"Users\u\.gradle\wrapper\dists\f"),
        it(r"Users\u\.gradle\jdks\f"),
    ];
    let tree = build(r"C:\", items);
    let out = tree.cleanup(&win());
    let (cleanup, review) = listed(&tree, &out);
    let crate_file =
        r"Users\u\.cargo\registry\cache\index.crates.io-6f17d22bba15001f\serde-1.0.0.crate";
    let expected = [
        crate_file.to_string(),
        local("Yarn\\Cache"),
        local("go-build"),
        local(r"pip\Cache\http-v2"),
        local(r"pip\Cache\wheels"),
    ];
    assert_eq!(cleanup, sorted(&expected));
    assert_eq!(review, [r"Users\u\.gradle\caches"]);
    let command = |path: &str| {
        let row = out.cleanup.iter().find(|r| rel(&tree, r.id) == path);
        row.unwrap().command
    };
    assert_eq!(
        command(&local(r"pip\Cache\wheels")),
        Some("pip cache purge")
    );
    assert_eq!(command(&local("go-build")), Some("go clean -cache"));
    assert!(out.cleanup.iter().all(|r| r.reason == Reason::PackageCache));
}

#[test]
fn bytecode_and_dev_folders_need_their_markers() {
    let tree = build(
        r"C:\",
        vec![
            it(r"src\a\__pycache__\m.cpython-312.pyc"),
            it(r"src\b\__pycache__\m.py"),
            it(r"src\b\__pycache__\n.pyc"),
            it(r"src\p\package.json"),
            it(r"src\p\package-lock.json"),
            it(r"src\p\node_modules\x.js"),
            it(r"src\q\package.json"),
            it(r"src\q\node_modules\x.js"),
            it(r"src\r\node_modules\x.js"),
            it(r"src\v\.venv\pyvenv.cfg"),
            it(r"src\w\venv\Lib\x.py"),
        ],
    );
    let out = tree.cleanup(&win());
    let (cleanup, review) = listed(&tree, &out);
    assert_eq!(cleanup, [r"src\a\__pycache__"]);
    assert_eq!(
        review,
        [r"src\p\node_modules", r"src\q\node_modules", r"src\v\.venv"]
    );
    let restorable = |path: &str| {
        let row = out.review.iter().find(|r| rel(&tree, r.id) == path);
        row.unwrap().restorable
    };
    assert_eq!(restorable(r"src\p\node_modules"), Some(true));
    assert_eq!(restorable(r"src\q\node_modules"), Some(false));
}

#[test]
fn tools_count_as_running_by_their_command_line() {
    let tree = build(
        r"C:\",
        vec![
            it(local(r"pip\Cache\http-v2\f")).size(3),
            it(local(r"npm-cache\_cacache\f")).size(5),
            it(r"Users\u\.gradle\caches\f").size(7),
        ],
    );
    let run = |procs: &[(&str, &str)]| {
        let mut ctx = win();
        ctx.running = procs
            .iter()
            .map(|&(exe, cmd)| Running {
                exe: exe.into(),
                cmd: cmd.into(),
            })
            .collect();
        let out = tree.cleanup(&ctx);
        (out.cleanup.len() + out.review.len(), out.info)
    };
    // Claude Code, an MCP server and a Java IDE do not hide the caches.
    let idle = run(&[
        ("node.exe", r"node c:\claude\cli.js"),
        ("python.exe", "python -m mcp_server"),
        ("java.exe", "java -jar idea.jar"),
    ]);
    assert_eq!(idle, (3, vec![]));
    let busy = run(&[
        ("python.exe", "python -m pip install x"),
        ("node.exe", r"node c:\npm\bin\npx-cli.js -y server"),
        (
            "java.exe",
            "java org.gradle.launcher.daemon.bootstrap.GradleDaemon",
        ),
    ]);
    assert_eq!(busy.0, 0);
    assert_eq!(busy.1.len(), 3);
    assert_eq!(run(&[("pip3.exe", "pip3 download x")]).0, 2);
}

#[test]
fn dotnet_restoring_counts_as_nuget_running() {
    let tree = build(
        r"C:\",
        vec![it(local(&format!(r"NuGet\v3-cache\{FEED}\f")))],
    );
    let run = |cmd: &str| {
        let mut ctx = win();
        ctx.running = vec![Running {
            exe: "dotnet.exe".into(),
            cmd: cmd.into(),
        }];
        tree.cleanup(&ctx).cleanup.len()
    };
    assert_eq!(
        run(r"dotnet c:\ls\microsoft.codeanalysis.languageserver.dll"),
        1
    );
    for cmd in [
        "dotnet restore",
        "dotnet build -c release",
        "dotnet nuget push x.nupkg",
    ] {
        assert_eq!(run(cmd), 0, "{cmd}");
    }
}
