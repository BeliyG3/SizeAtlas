//! The Temp rules (1, 1b) with the real tables: age, work markers, size, exclusions.

use super::tests::{Item, ago, build, it, listed, rel, rows, win};
use super::*;
use crate::tree::flags;

fn temp(rest: &str) -> String {
    format!(r"Users\u\AppData\Local\Temp\{rest}")
}

#[test]
fn old_temp_items_split_by_work_and_size() {
    let tree = build(
        r"C:\",
        vec![
            it(temp(r"old\a.tmp")).mtime(ago(90)),
            it(temp(r"work\deep\er\scene.blend")).mtime(ago(90)),
            it(temp(r"big\a.bin")).mtime(ago(90)).size(2 << 30),
            it(temp("fresh.log")).mtime(ago(6)),
        ],
    );
    let out = tree.cleanup(&win());
    let (cleanup, review) = listed(&tree, &out);
    assert_eq!(cleanup, [temp("old")]);
    assert_eq!(review, [temp("big"), temp("work")]);
    let reason = |path: String| {
        let row = out.review.iter().find(|r| rel(&tree, r.id) == path);
        row.unwrap().reason
    };
    assert_eq!(reason(temp("work")), Reason::TempWork);
    assert_eq!(reason(temp("big")), Reason::TempLarge);
    assert_eq!(out.cleanup[0].reason, Reason::TempOld);
}

#[test]
fn temp_exclusions_list_nothing_in_any_mode() {
    let mut items: Vec<Item> = [
        "claude",
        "Low",
        "Temp1_x.zip",
        "7zS1A2B",
        "codex-run",
        "cursor-sandbox",
        "com.sizeatlas.app",
        "EBWebView",
    ]
    .iter()
    .map(|name| it(temp(&format!(r"{name}\big.bin"))).size(2 << 30))
    .collect();
    items.push(it(r"Windows\Temp\7zS99\f"));
    items.push(it(temp(r"ok\f")));
    items.push(it(r"Windows\Temp\ok\f"));
    assert_eq!(
        rows(items, &win()),
        (vec![temp("ok"), r"Windows\Temp\ok".into()], vec![])
    );
}

#[test]
fn ai_tool_work_in_temp_hides_the_dev_folders_inside() {
    let items = vec![
        it(temp(r"claude\s1\proj\package.json")),
        it(temp(r"claude\s1\proj\node_modules\x.js")),
        it(temp(r"claude\s1\proj\__pycache__\a.pyc")),
        it(temp(r"claude\s1\proj\.venv\pyvenv.cfg")),
        it(temp(r"old\f")),
    ];
    assert_eq!(rows(items, &win()), (vec![temp("old")], vec![]));
}

#[test]
fn lm_studio_models_and_tools_are_listed_nowhere() {
    let studio = |rest: &str| format!(r"Users\u\.cache\lm-studio\{rest}");
    let items = vec![
        it(studio(r"models\org\m\model.gguf")),
        it(studio(r"extensions\backends\venv\pyvenv.cfg")),
        it(studio(r"extensions\plugin\package.json")),
        it(studio(r"extensions\plugin\node_modules\x.js")),
        it(studio(r"extensions\plugin\__pycache__\a.pyc")),
        it(r"Users\u\src\p\package.json"),
        it(r"Users\u\src\p\node_modules\x.js"),
    ];
    let control = r"Users\u\src\p\node_modules";
    assert_eq!(rows(items, &win()), (vec![], vec![control.into()]));
}

#[test]
fn nothing_inside_a_young_temp_item_is_listed() {
    let items = vec![
        it(temp(r"young\new.txt")).mtime(ago(1)),
        it(temp(r"young\p\package.json")),
        it(temp(r"young\p\node_modules\x.js")),
        it(temp(r"young\__pycache__\a.pyc")),
        it(temp("week.log")).mtime(ago(6)),
        it(temp("month.log")),
    ];
    assert_eq!(rows(items, &win()), (vec![temp("month.log")], vec![]));
}

#[test]
fn the_system_temp_needs_access_and_no_pending_restart() {
    let tree = build(
        r"C:\",
        vec![it(r"Windows\Temp\").flags(flags::ACCESS_ERROR)],
    );
    let out = tree.cleanup(&win());
    assert_eq!(listed(&tree, &out), (vec![], vec![]));
    assert!(matches!(&out.info[..], [Info::NoAccess { path, .. }] if path.ends_with("Temp")));

    let items = || vec![it(r"Windows\Temp\old\f"), it(temp(r"old\f"))];
    assert_eq!(
        rows(items(), &win()).0,
        [temp("old"), r"Windows\Temp\old".into()]
    );
    let mut ctx = win();
    ctx.reboot_pending = true;
    assert_eq!(rows(items(), &ctx).0, [temp("old")]);
}
