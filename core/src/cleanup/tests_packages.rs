//! The Windows package rules (8), the "anywhere" rules (9, "Check before deleting") and the
//! tools that count as running by their command line.

use super::tests::{Item, build, it, listed, rel, win};
use super::*;

fn local(rest: &str) -> String {
    format!(r"Users\u\AppData\Local\{rest}")
}

fn rows(items: Vec<Item>, ctx: &Context) -> (Vec<String>, Vec<String>) {
    let tree = build(r"C:\", items);
    listed(&tree, &tree.cleanup(ctx))
}

fn sorted<S: AsRef<str>>(paths: &[S]) -> Vec<String> {
    let mut v: Vec<String> = paths.iter().map(|p| p.as_ref().to_owned()).collect();
    v.sort();
    v
}

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

#[test]
fn a_nuget_cache_override_wins_over_the_default_place() {
    let items = || {
        vec![
            it(r"caches\nuget-http\a\f"),
            it(local(r"NuGet\v3-cache\a\f")),
        ]
    };
    assert_eq!(rows(items(), &win()).0, [local(r"NuGet\v3-cache")]);
    let mut ctx = win();
    ctx.known.env.nuget_http = Some(r"C:\caches\nuget-http".into());
    assert_eq!(rows(items(), &ctx).0, [r"caches\nuget-http"]);
}

#[test]
fn a_go_cache_is_recognised_by_its_readme() {
    let mut ctx = win();
    ctx.known.env.go_cache = Some(r"C:\work\gocache".into());
    let without = vec![it(r"work\gocache\00\f"), it(local(r"go-build\README"))];
    assert_eq!(rows(without, &ctx), (vec![], vec![]));
    let with = vec![it(r"work\gocache\00\f"), it(r"work\gocache\README")];
    assert_eq!(rows(with, &ctx).0, [r"work\gocache"]);
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
        it(local(r"go-build\README")),
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
