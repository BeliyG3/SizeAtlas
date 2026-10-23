//! What a matched item turns into: busy content, unreadable places, apps, info spots.

use super::tests::{ago, build, id, it, listed, run, win};
use super::*;
use crate::tree::flags;

const TEMP: &str = r"Users\u\AppData\Local\Temp";

fn temp(rest: &str) -> String {
    format!(r"{TEMP}\{rest}")
}

#[test]
fn busy_content_inside_a_match_lists_nothing() {
    let tree = build(
        r"C:\",
        vec![
            it(temp(r"ofps-1\run\")).flags(flags::PENDING),
            it(temp(r"ofps-1\a.bin")),
            it(r"p\package.json"),
            it(r"p\node_modules\x\").flags(flags::SCANNING),
            it(temp(r"fine\a.tmp")),
            it(r"q\package.json"),
            it(r"q\node_modules\y.js"),
        ],
    );
    let out = run(&tree, &win());
    assert_eq!(
        listed(&tree, &out),
        (vec![temp("fine")], vec![r"q\node_modules".into()])
    );
    assert!(out.info.is_empty());
}

#[test]
fn unreadable_places_are_reported_once_and_not_for_young_items() {
    let tree = build(
        r"C:\",
        vec![
            it(temp(r"old\a\")).flags(flags::ACCESS_ERROR),
            it(temp(r"old\b\")).flags(flags::ACCESS_ERROR),
            it(temp(r"young\a\")).flags(flags::ACCESS_ERROR),
            it(temp(r"young\b")).mtime(ago(1)),
            it(r"Users\u\AppData\Local\Google\Chrome\User Data\One\").flags(flags::ACCESS_ERROR),
            it(r"Users\u\AppData\Local\Google\Chrome\User Data\Two\").flags(flags::ACCESS_ERROR),
            it(r"Users\u\.ssh\").flags(flags::ACCESS_ERROR),
        ],
    );
    let out = run(&tree, &win());
    let paths: Vec<String> = out
        .info
        .iter()
        .map(|i| match i {
            Info::NoAccess { path } => path.replace('/', "\\"),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(paths.len(), 2, "{paths:?}");
    assert!(paths.iter().any(|p| p.ends_with(r"Temp\old")));
    assert!(paths.iter().any(|p| p.contains("User Data")));
    assert!(out.approximate);

    let tree = build(
        r"C:\",
        vec![
            it(temp(r"young\a\"))
                .flags(flags::ACCESS_ERROR)
                .mtime(ago(1)),
        ],
    );
    let out = run(&tree, &win());
    assert!(out.info.is_empty() && !out.approximate);
}

#[test]
fn an_app_command_line_matches_ignoring_case() {
    const GRADLE: App = App {
        name: "Gradle",
        exes: &["java.exe"],
        cmd: Some("GradleDaemon"),
    };
    let rule = Rule {
        app: Some(&GRADLE),
        ..Rule::new(
            Place::At(At::GradleHome, &[]),
            Target::Dir("caches"),
            Mode::Review,
            Reason::GradleCache,
        )
    };
    let tree = build(r"C:\", vec![it(r"Users\u\.gradle\caches\a").size(4)]);
    let mut ctx = win();
    ctx.running = vec![Running {
        exe: "java.exe".into(),
        cmd: "java org.gradle.launcher.daemon.bootstrap.gradledaemon 8.10".into(),
    }];
    let out = tree.cleanup_with(&ctx, &[rule], &[]);
    assert!(out.review.is_empty());
    assert_eq!(
        out.info,
        [Info::AppRunning {
            app: "Gradle",
            size: 4
        }]
    );
}

#[test]
fn an_info_spot_is_never_inside_a_row() {
    let broad = Rule::new(
        Place::At(At::Local, &[]),
        Target::Dir("*"),
        Mode::Cleanup,
        Reason::AppCache,
    );
    let berry = Spot {
        at: At::Local,
        path: &["Yarn", "Berry", "cache"],
        kind: SpotKind::ToolStore("yarn cache clean"),
    };
    let local = r"Users\u\AppData\Local";
    let tree = build(
        r"C:\",
        vec![
            it(format!(r"{local}\Yarn\Berry\cache\a.zip")),
            it(format!(r"{local}\Other\a")),
        ],
    );
    let out = tree.cleanup_with(&win(), &[broad], &[berry]);
    assert_eq!(listed(&tree, &out).0, [format!(r"{local}\Other")]);
    assert_eq!(
        out.info,
        [Info::ToolStore {
            id: id(&tree, &format!(r"{local}\Yarn\Berry\cache")),
            command: "yarn cache clean"
        }]
    );
}
