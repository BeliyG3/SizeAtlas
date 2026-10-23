//! Zones of "anywhere" rules.

use super::tests::{build, it, listed, run, win};
use super::*;
use crate::tree::flags;

/// A project with a `node_modules` below `at`.
fn project(at: &str) -> Vec<tests::Item> {
    vec![
        it(format!(r"{at}\package.json")),
        it(format!(r"{at}\node_modules\x.js")),
    ]
}

fn review(root: &str, items: Vec<tests::Item>, ctx: &Context) -> Vec<String> {
    let tree = build(root, items);
    listed(&tree, &run(&tree, ctx)).1
}

#[test]
fn anywhere_rules_skip_installed_programs_and_system_places() {
    for at in [
        r"Program Files\App\resources\app",
        r"Program Files (x86)\App",
        r"ProgramData\Tool",
        r"Windows\Web",
        r"$Recycle.Bin\S-1-5\$R1",
        r"System Volume Information\x",
        r"games\steamapps\common\G",
    ] {
        assert!(review(r"C:\", project(at), &win()).is_empty(), "{at}");
    }
    assert!(review(r"D:\", project(r"Program Files\App"), &win()).is_empty());
    assert_eq!(
        review(r"D:\", project("work"), &win()),
        [r"work\node_modules"]
    );
}

#[test]
fn anywhere_rules_skip_other_profiles_but_not_the_own_one() {
    assert!(review(r"C:\", project(r"Users\other\p"), &win()).is_empty());
    assert!(review(r"C:\", project(r"Users\Public\p"), &win()).is_empty());
    assert_eq!(
        review(r"C:\", project(r"Users\u\p"), &win()),
        [r"Users\u\p\node_modules"]
    );
}

#[test]
fn anywhere_rules_skip_app_data_and_home_dot_folders() {
    for at in [
        r"Users\u\AppData\Local\Programs\x",
        r"Users\u\AppData\Local\Temp\old",
        r"Users\u\AppData\Roaming\Code\x",
        r"Users\u\AppData\LocalLow\x",
        r"Users\u\.vscode\extensions\x",
        r"Users\u\.cursor\extensions\x",
    ] {
        let rows = review(r"C:\", project(at), &win());
        assert!(rows.iter().all(|r| !r.ends_with("node_modules")), "{at}");
    }
    assert_eq!(
        review(r"C:\", project(r"Users\u\src\p"), &win()),
        [r"Users\u\src\p\node_modules"]
    );
}

#[test]
fn anywhere_rules_skip_cloud_folders() {
    assert!(review(r"C:\", project(r"Users\u\OneDrive\p"), &win()).is_empty());
    let mut items = project(r"sync\p");
    items.push(it(r"sync\").flags(flags::CLOUD));
    assert!(review(r"C:\", items, &win()).is_empty());
}

#[test]
fn without_a_recycle_bin_anywhere_rules_list_nothing() {
    let mut items = project(r"src\p");
    items.push(it(r"Users\u\AppData\Local\Temp\old\a"));
    let tree = build(r"C:\", items);
    let mut ctx = win();
    ctx.recyclable = false;
    let (cleanup, review) = listed(&tree, &run(&tree, &ctx));
    assert!(review.is_empty());
    assert_eq!(cleanup, [r"Users\u\AppData\Local\Temp\old"]);
}

#[test]
fn unix_zones_hold_installed_programs() {
    let mut ctx = win();
    ctx.os = Os::Linux;
    ctx.known = Known {
        home: "/home/u".into(),
        users: Some("/home".into()),
        ..Known::default()
    };
    let unix = |at: &str| {
        let mut items = project(at);
        for i in &mut items {
            *i = it(i.path().replace('\\', "/"));
        }
        review("/", items, &ctx)
    };
    assert!(unix("usr/lib").is_empty());
    assert!(unix("home/other/p").is_empty());
    assert!(unix("home/u/.nvm/x").is_empty());
    assert!(unix("tmp/p").is_empty());
    assert_eq!(unix("home/u/p"), [r"home\u\p\node_modules"]);
}

#[test]
fn a_scan_root_below_a_known_folder_still_matches() {
    let tree = build(r"C:\Users\u\AppData\Local\Temp", vec![it(r"old\a")]);
    assert_eq!(listed(&tree, &run(&tree, &win())).0, ["old"]);
    let tree = build(r"\\?\C:\Users\u\AppData\Local\Temp\old", vec![it("a")]);
    assert_eq!(run(&tree, &win()), Cleanup::default());
}

#[test]
fn without_a_users_folder_the_parent_of_home_is_one() {
    let mut ctx = win();
    ctx.known.users = None;
    let mut items = project(r"Users\other\src\app");
    items.push(it(
        r"Users\other\AppData\Local\Programs\Python\Lib\__pycache__\a.pyc",
    ));
    items.extend(project(r"Users\u\src\app"));
    let tree = build(r"C:\", items);
    let out = run(&tree, &ctx);
    assert_eq!(
        listed(&tree, &out),
        (vec![], vec![r"Users\u\src\app\node_modules".into()])
    );
}

#[test]
fn on_windows_an_unknown_system_place_turns_anywhere_rules_off() {
    let blank: [fn(&mut Known); 4] = [
        |k| k.system_root.clear(),
        |k| k.program_data.clear(),
        |k| k.program_files.clear(),
        |k| {
            k.users = None;
            k.home.clear();
        },
    ];
    let mut items = project(r"src\p");
    items.push(it(r"Users\u\AppData\Local\Temp\old\a"));
    let tree = build(r"C:\", items);
    for (n, blank) in blank.iter().enumerate() {
        let mut ctx = win();
        blank(&mut ctx.known);
        let (cleanup, review) = listed(&tree, &run(&tree, &ctx));
        assert!(review.is_empty(), "case {n}");
        assert_eq!(cleanup, [r"Users\u\AppData\Local\Temp\old"], "case {n}");
    }
    assert_eq!(
        listed(&tree, &run(&tree, &win())).1,
        [r"src\p\node_modules"]
    );
}

/// Review rows of a Unix project at `at` (no leading `/`) with `home` and no `users`.
fn unix_rows(os: Os, home: &str, at: &str) -> Vec<String> {
    let mut ctx = win();
    ctx.os = os;
    ctx.known = Known {
        home: home.into(),
        ..Known::default()
    };
    let items = project(at)
        .into_iter()
        .map(|i| it(i.path().replace('\\', "/")))
        .collect();
    review("/", items, &ctx)
}

#[test]
fn on_unix_a_home_without_a_users_folder_turns_anywhere_rules_off() {
    assert!(unix_rows(Os::Linux, "/root", "home/alice/p").is_empty());
    assert!(unix_rows(Os::Linux, "/root", "srv/p").is_empty());
    assert!(unix_rows(Os::Mac, "/var/root", "Users/alice/p").is_empty());
    assert!(unix_rows(Os::Mac, "/var/root", "srv/p").is_empty());
    assert!(unix_rows(Os::Linux, "", "srv/p").is_empty());
    assert!(unix_rows(Os::Mac, "", "srv/p").is_empty());
    // The usual homes still have rows, and other profiles stay a zone.
    assert_eq!(
        unix_rows(Os::Linux, "/home/u", "home/u/p"),
        [r"home\u\p\node_modules"]
    );
    assert!(unix_rows(Os::Linux, "/home/u", "home/alice/p").is_empty());
    assert_eq!(
        unix_rows(Os::Mac, "/Users/u", "Users/u/p"),
        [r"Users\u\p\node_modules"]
    );
    assert!(unix_rows(Os::Mac, "/Users/u", "Users/alice/p").is_empty());
    assert_eq!(
        unix_rows(Os::Linux, "/home/u", "srv/p"),
        [r"srv\p\node_modules"]
    );
}

#[test]
fn on_windows_a_home_at_a_drive_root_is_no_users_folder() {
    let mut ctx = win();
    ctx.known.users = None;
    ctx.known.home = r"C:\u".into();
    assert!(review(r"C:\", project(r"src\p"), &ctx).is_empty());
}
