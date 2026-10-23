//! The engine on stub rules: shadowing, markers, age and size splits, apps, unreadable,
//! cloud and pending content.

use super::tests::{DISCORD, NPM, ago, build, id, it, listed, rel, run, win};
use super::*;
use crate::tree::flags;

const TEMP: &str = r"Users\u\AppData\Local\Temp";

fn temp(rest: &str) -> String {
    format!(r"{TEMP}\{rest}")
}

#[test]
fn a_node_modules_inside_another_lists_only_the_outer_one() {
    let tree = build(
        r"C:\",
        vec![
            it(r"p\package.json"),
            it(r"p\node_modules\a\package.json"),
            it(r"p\node_modules\a\node_modules\b\i.js"),
            it(r"q\node_modules\x.js"),
        ],
    );
    let out = run(&tree, &win());
    // `q` has no package.json next to its node_modules.
    assert_eq!(
        listed(&tree, &out),
        (vec![], vec![r"p\node_modules".into()])
    );
    assert_eq!(out.review[0].restorable, Some(false));
}

#[test]
fn a_lock_file_makes_node_modules_restorable() {
    let tree = build(
        r"C:\",
        vec![
            it(r"p\package.json"),
            it(r"p\package-lock.json"),
            it(r"p\node_modules\x.js"),
        ],
    );
    assert_eq!(run(&tree, &win()).review[0].restorable, Some(true));
}

#[test]
fn a_pycache_inside_a_venv_lists_only_the_venv() {
    let tree = build(
        r"C:\",
        vec![
            it(r"p\.venv\pyvenv.cfg"),
            it(r"p\.venv\Lib\__pycache__\a.pyc"),
            it(r"p\src\__pycache__\b.pyc"),
            it(r"p\other\__pycache__\b.pyc"),
            it(r"p\other\__pycache__\notes.txt"),
            it(r"p\requirements-dev.txt"),
        ],
    );
    let out = run(&tree, &win());
    assert_eq!(
        listed(&tree, &out),
        (vec![r"p\src\__pycache__".into()], vec![r"p\.venv".into()])
    );
    assert_eq!(out.review[0].restorable, Some(true));
    assert_eq!(out.cleanup[0].restorable, None);
}

#[test]
fn a_venv_with_torch_and_crypto_packages_is_still_listed() {
    let tree = build(
        r"C:\",
        vec![
            it(r"p\.venv\pyvenv.cfg"),
            it(r"p\.venv\Lib\site-packages\torch\__init__.py"),
            it(r"p\.venv\Lib\site-packages\Crypto\Cipher\AES.py"),
        ],
    );
    let out = run(&tree, &win());
    assert_eq!(out.review.len(), 1);
    assert_eq!(out.review[0].reason, Reason::PythonVenv);
}

#[test]
fn a_protected_name_inside_a_matching_folder_blocks_it() {
    for inner in [r"keys\.ssh\id_rsa", r"m\model.gguf", r"mail\Outlook.PST"] {
        let tree = build(
            r"C:\",
            vec![
                it(temp(&format!(r"old\{inner}"))),
                it(r"p\package.json"),
                it(format!(r"p\node_modules\{inner}")),
                it(temp(r"fine\a.tmp")),
            ],
        );
        let out = run(&tree, &win());
        assert_eq!(listed(&tree, &out), (vec![temp("fine")], vec![]), "{inner}");
    }
}

#[test]
fn temp_items_split_by_age_work_markers_and_size() {
    let tree = build(
        r"C:\",
        vec![
            it(temp(r"old\a.tmp")),
            it(temp(r"young\a.tmp")).mtime(ago(2)),
            it(temp(r"scene\autosave.blend")),
            it(temp(r"repo\.git\HEAD")),
            it(temp(r"big\a.bin")).size(2 << 30),
            it(temp("loose.log")),
        ],
    );
    let out = run(&tree, &win());
    let (cleanup, review) = listed(&tree, &out);
    assert_eq!(cleanup, [temp("loose.log"), temp("old")]);
    assert_eq!(review, [temp("big"), temp("repo"), temp("scene")]);
    let reason = |name: &str| {
        let row = out.review.iter().find(|r| rel(&tree, r.id) == temp(name));
        row.unwrap().reason
    };
    assert_eq!(reason("big"), Reason::TempLarge);
    assert_eq!(reason("repo"), Reason::TempWork);
    assert_eq!(reason("scene"), Reason::TempWork);
}

#[test]
fn crash_dumps_younger_than_the_split_go_to_review() {
    let tree = build(
        r"C:\",
        vec![
            it(r"Users\u\AppData\Local\CrashDumps\old.dmp").mtime(ago(20)),
            it(r"Users\u\AppData\Local\CrashDumps\new.dmp").mtime(ago(3)),
            it(r"Users\u\AppData\Local\CrashDumps\notes.txt").mtime(ago(20)),
        ],
    );
    let out = run(&tree, &win());
    assert_eq!(out.cleanup.len(), 1);
    assert_eq!(out.cleanup[0].reason, Reason::CrashDump);
    assert_eq!(out.review.len(), 1);
    assert_eq!(out.review[0].reason, Reason::CrashDumpRecent);
}

#[test]
fn a_running_app_turns_its_rows_into_one_info() {
    let tree = build(
        r"C:\",
        vec![
            it(r"Users\u\AppData\Roaming\discord\Code Cache\a").size(5),
            it(r"Users\u\AppData\Roaming\discordptb\Code Cache\a").size(7),
            it(r"Users\u\AppData\Local\npm-cache\_cacache\x").size(3),
        ],
    );
    let mut ctx = win();
    ctx.running = vec![
        Running {
            exe: "discordptb.exe".into(),
            cmd: String::new(),
        },
        Running {
            exe: "node.exe".into(),
            cmd: "node c:\\claude\\cli.js".into(),
        },
    ];
    let out = run(&tree, &ctx);
    assert_eq!(out.cleanup.len(), 1, "npm is not running");
    assert_eq!(out.cleanup[0].command, Some("npm cache clean --force"));
    assert_eq!(
        out.info,
        [Info::AppRunning {
            app: DISCORD.name,
            mode: Mode::Cleanup,
            // In the order of the walk.
            ids: vec![
                id(&tree, r"Users\u\AppData\Roaming\discordptb\Code Cache"),
                id(&tree, r"Users\u\AppData\Roaming\discord\Code Cache"),
            ],
            size: 12
        }]
    );

    ctx.running[1].cmd = "node c:\\npm\\bin\\npm-cli.js install".into();
    let out = run(&tree, &ctx);
    assert!(out.cleanup.is_empty());
    assert!(out.info.contains(&Info::AppRunning {
        app: NPM.name,
        mode: Mode::Cleanup,
        ids: vec![id(&tree, r"Users\u\AppData\Local\npm-cache\_cacache")],
        size: 3
    }));
}

#[test]
fn an_unreadable_folder_inside_a_match_is_reported_not_listed() {
    let tree = build(
        r"C:\",
        vec![
            it(temp(r"old\locked\")).flags(flags::ACCESS_ERROR),
            it(r"p\package.json"),
            it(r"p\node_modules\x.js"),
        ],
    );
    let out = run(&tree, &win());
    assert_eq!(listed(&tree, &out).0, Vec::<String>::new());
    assert_eq!(out.review.len(), 1);
    assert!(out.approximate);
    assert!(matches!(&out.info[..], [Info::NoAccess { path, .. }] if path.ends_with("old")));
}

#[test]
fn an_unreadable_place_of_a_rule_is_reported() {
    let tree = build(
        r"C:\",
        vec![it(r"Windows\Temp\").flags(flags::ACCESS_ERROR)],
    );
    let out = run(&tree, &win());
    assert!(out.approximate);
    assert!(matches!(&out.info[..], [Info::NoAccess { path, .. }] if path.ends_with("Temp")));
}

#[test]
fn the_system_temp_waits_for_a_pending_restart() {
    let tree = build(r"C:\", vec![it(r"Windows\Temp\old\a")]);
    let mut ctx = win();
    assert_eq!(listed(&tree, &run(&tree, &ctx)).0, [r"Windows\Temp\old"]);
    ctx.reboot_pending = true;
    assert!(run(&tree, &ctx).cleanup.is_empty());
}

#[test]
fn cloud_content_inside_a_match_lists_nothing() {
    let tree = build(
        r"C:\",
        vec![
            it(temp(r"old\online.docx")).flags(flags::CLOUD),
            it(temp(r"fine\a.tmp")),
        ],
    );
    let out = run(&tree, &win());
    assert_eq!(listed(&tree, &out), (vec![temp("fine")], vec![]));
    assert!(out.info.is_empty());
}

#[test]
fn nothing_is_listed_while_a_folder_is_being_scanned() {
    let items = || {
        vec![
            it(temp(r"old\a")),
            it(r"p\package.json"),
            it(r"p\node_modules\x.js"),
        ]
    };
    let mut tree = build(r"C:\", items());
    tree.set_scanning(0, true);
    assert_eq!(run(&tree, &win()), Cleanup::default());

    let mut tree = build(r"C:\", items());
    let p = id(&tree, "p");
    tree.nodes_mut_for_test()[p as usize].flags |= flags::PENDING;
    let out = run(&tree, &win());
    assert!(out.review.is_empty());
    assert_eq!(out.cleanup.len(), 1);
}

#[test]
fn rows_of_both_modes_never_overlap() {
    let tree = build(
        r"C:\",
        vec![
            it(temp(r"old\p\package.json")),
            it(temp(r"old\p\node_modules\x")),
            it(temp("loose")),
            it(r"Users\u\AppData\Local\Google\Chrome\User Data\Default\Preferences"),
            it(r"Users\u\AppData\Local\Google\Chrome\User Data\Default\Cache\data_0"),
            it(r"Users\u\AppData\Local\Google\Chrome\User Data\Stray\Cache\data_0"),
            it(r"src\p\package.json"),
            it(r"src\p\node_modules\q\.venv\pyvenv.cfg"),
            it(r"src\p\node_modules\q\__pycache__\a.pyc"),
            it(r"src\py\.venv\pyvenv.cfg"),
            it(r"src\py\__pycache__\a.pyc"),
        ],
    );
    let out = run(&tree, &win());
    let rows: Vec<u32> = out
        .cleanup
        .iter()
        .chain(&out.review)
        .map(|r| r.id)
        .collect();
    assert_eq!(rows.len(), 6, "{:?}", listed(&tree, &out));
    for &a in &rows {
        for &b in &rows {
            let mut up = tree.node(b).parent;
            while a != b && up != crate::tree::NO_PARENT {
                assert_ne!(up, a, "{} inside {}", rel(&tree, b), rel(&tree, a));
                up = tree.node(up).parent;
            }
        }
    }
    assert!(out.cleanup.iter().all(|r| r.mode == Mode::Cleanup));
    assert!(out.review.iter().all(|r| r.mode == Mode::Review));
}
