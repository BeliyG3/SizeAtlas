//! The macOS and Linux tables.

use super::tests::{ago, build, it, rows};
use super::*;

fn ctx(os: Os, home: &str) -> Context {
    Context {
        os,
        known: Known {
            home: home.into(),
            ..Known::default()
        },
        running: vec![],
        reboot_pending: false,
        recyclable: true,
    }
}

#[test]
fn macos_offers_only_its_listed_caches() {
    let lib = |rest: &str| format!("Users/u/Library/{rest}");
    let items = vec![
        it(lib("Caches/pip/http-v2/a/f")),
        it(lib("Caches/Homebrew/downloads/f")),
        it(lib("Caches/go-build/trim.txt")),
        it(lib("Caches/com.microsoft.VSCode.ShipIt/f")),
        it(lib("Caches/Google/Chrome/Default/Cache/f")),
        it(lib("Caches/Google/Chrome/Default/Code Cache/f")),
        it(lib("Caches/Google/Chrome/Default/Other/f")),
        it(lib("Caches/Firefox/Profiles/x.default/cache2/f")),
        it(lib("Caches/com.apple.Safari/f")),
        it(lib("Caches/com.other.app/f")),
        it(lib("Logs/DiagnosticReports/old.ips")),
        it(lib("Logs/DiagnosticReports/new.ips")).mtime(ago(3)),
        it(lib("Developer/Xcode/DerivedData/App-abc/f")),
        it(lib("Developer/Xcode/Archives/2026/f")),
        it("Users/u/.npm/_cacache/f"),
        it("Users/u/.npm/_npx/1a/node_modules/x.js"),
        it("Users/u/.cargo/registry/cache/i/a-1.0.crate"),
        it("Users/u/.cargo/registry/src/i/a/lib.rs"),
    ];
    let (cleanup, review) = rows(items, &ctx(Os::Mac, "/Users/u"));
    let mut expected = vec![
        lib("Caches/pip/http-v2"),
        lib("Caches/Homebrew"),
        lib("Caches/go-build"),
        lib("Caches/com.microsoft.VSCode.ShipIt"),
        lib("Caches/Google/Chrome/Default/Cache"),
        lib("Caches/Google/Chrome/Default/Code Cache"),
        lib("Caches/Firefox/Profiles/x.default/cache2"),
        lib("Logs/DiagnosticReports/old.ips"),
        "Users/u/.npm/_cacache".into(),
        "Users/u/.cargo/registry/cache/i/a-1.0.crate".into(),
    ];
    expected.sort();
    assert_eq!(cleanup, expected);
    assert_eq!(review, [lib("Developer/Xcode/DerivedData")]);
}

#[test]
fn macos_never_offers_apple_caches_or_other_apps() {
    let items = vec![
        it("Users/u/Library/Caches/com.apple.x/f"),
        it("Users/u/Library/Caches/com.other.y/f"),
        it("Users/u/Library/Caches/pip/http/f"),
    ];
    let control = "Users/u/Library/Caches/pip/http";
    assert_eq!(
        rows(items, &ctx(Os::Mac, "/Users/u")),
        (vec![control.into()], vec![])
    );
}

#[test]
fn a_running_mac_browser_hides_its_cache() {
    let mut mac = ctx(Os::Mac, "/Users/u");
    mac.running = vec![Running {
        exe: "google chrome".into(),
        cmd: String::new(),
    }];
    let tree = build(
        "/",
        vec![it("Users/u/Library/Caches/Google/Chrome/Default/Cache/f").size(4)],
    );
    let out = tree.cleanup(&mac);
    assert!(out.cleanup.is_empty());
    assert_eq!(
        out.info,
        [Info::AppRunning {
            app: "Google Chrome",
            size: 4
        }]
    );
}

#[test]
fn linux_follows_xdg_cache_home_and_skips_tmp() {
    let mut linux = ctx(Os::Linux, "/home/u");
    linux.known.xdg_cache = Some("/home/u/xc".into());
    let xc = |rest: &str| format!("home/u/xc/{rest}");
    let items = vec![
        it(xc("pip/http/f")),
        it(xc("thumbnails/large/f")),
        it(xc("mesa_shader_cache/f")),
        it(xc("mesa_shader_cache_db/f")),
        it(xc("mozilla/firefox/p.default/cache2/f")),
        it(xc("google-chrome/Default/Cache/f")),
        it(xc("google-chrome/Default/Code Cache/f")),
        it(xc("chromium/Default/GPUCache/f")),
        it(xc("other/f")),
        it("home/u/.cache/thumbnails/f"),
        it("home/u/.npm/_cacache/f"),
        it("home/u/.cargo/registry/cache/i/a-1.0.crate"),
        it("tmp/x"),
        it("var/tmp/x"),
    ];
    let (cleanup, review) = rows(items, &linux);
    let mut expected = vec![
        xc("pip/http"),
        xc("thumbnails"),
        xc("mesa_shader_cache"),
        xc("mesa_shader_cache_db"),
        xc("mozilla/firefox/p.default/cache2"),
        xc("google-chrome/Default/Cache"),
        xc("google-chrome/Default/Code Cache"),
        xc("chromium/Default/GPUCache"),
        "home/u/.npm/_cacache".into(),
        "home/u/.cargo/registry/cache/i/a-1.0.crate".into(),
    ];
    expected.sort();
    assert_eq!(cleanup, expected);
    assert!(review.is_empty());

    let plain = ctx(Os::Linux, "/home/u");
    let items = vec![
        it("home/u/.cache/thumbnails/f"),
        it("tmp/x"),
        it("var/tmp/x"),
    ];
    assert_eq!(
        rows(items, &plain),
        (vec!["home/u/.cache/thumbnails".into()], vec![])
    );
}
