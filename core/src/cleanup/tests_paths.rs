//! Age and path matching.

use super::paths::{components, fits};
use super::tests::{ago, build, id, it, listed, run, win};
use super::*;

#[test]
fn an_unknown_time_is_never_old() {
    let tree = build(r"C:\", vec![it(r"t\a").mtime(ago(40)), it(r"t\b").mtime(0)]);
    assert_eq!(newest_mtime(&tree, id(&tree, r"t\a")), Some(ago(40)));
    assert_eq!(newest_mtime(&tree, id(&tree, "t")), None);
    assert!(!is_old(&tree, id(&tree, "t"), 7));
    assert!(is_old(&tree, id(&tree, r"t\a"), 7));
}

#[test]
fn age_compares_ns_times_with_the_scan_in_seconds() {
    let tree = build(
        r"C:\",
        vec![it("six").mtime(ago(6)), it("eight").mtime(ago(8))],
    );
    assert!(!is_old(&tree, id(&tree, "six"), 7));
    assert!(is_old(&tree, id(&tree, "eight"), 7));
}

#[test]
fn a_folder_is_as_young_as_its_newest_item() {
    let tree = build(
        r"C:\",
        vec![it(r"d\old").mtime(ago(30)), it(r"d\new").mtime(ago(1))],
    );
    assert_eq!(newest_mtime(&tree, id(&tree, "d")), Some(ago(1)));
    assert!(!is_old(&tree, id(&tree, "d"), 7));
}

#[test]
fn windows_paths_split_on_both_separators_without_the_long_prefix() {
    assert_eq!(
        components(Os::Windows, r"\\?\C:\Users/u\"),
        ["C:", "Users", "u"]
    );
    assert_eq!(
        components(Os::Windows, r"\\?\UNC\srv\share"),
        ["srv", "share"]
    );
    assert_eq!(components(Os::Linux, r"/home/u\x"), ["home", r"u\x"]);
    assert!(components(Os::Linux, "/").is_empty());
}

#[test]
fn masks_fold_case_only_when_asked() {
    assert!(fits("*.DMP", "memory.dmp", true));
    assert!(!fits("*.DMP", "memory.dmp", false));
    assert!(fits("discord*.exe", "discordptb.exe", true));
    assert!(fits("Opera*", "Opera GX Stable", false));
    assert!(fits("ТЕМП", "темп", true));
    assert!(!fits("*.dmp", "dmp", true));
}

#[test]
fn known_temp_matches_ignoring_case_on_windows_only() {
    let items = || vec![it(r"Users\u\AppData\Local\Temp\old\x")];
    let tree = build(r"C:\", items());
    let mut ctx = win();
    ctx.known.temp = r"c:\USERS\u\appdata\local\temp".into();
    assert_eq!(
        listed(&tree, &run(&tree, &ctx)).0,
        [r"Users\u\AppData\Local\Temp\old"]
    );

    let tree = build("/", vec![it("home/u/tmp/old/x")]);
    let mut ctx = win();
    ctx.os = Os::Linux;
    ctx.known = Known {
        temp: "/home/u/TMP".into(),
        ..Known::default()
    };
    assert!(run(&tree, &ctx).cleanup.is_empty());
    ctx.known.temp = "/home/u/tmp".into();
    assert_eq!(listed(&tree, &run(&tree, &ctx)).0, ["home\\u\\tmp\\old"]);
}
