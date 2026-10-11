use super::*;

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn quote_arg_quotes_a_drive_root() {
    assert_eq!(quote_arg(r"C:\"), r#""C:\\""#);
}

#[test]
fn quote_arg_keeps_inner_backslashes_and_spaces() {
    assert_eq!(
        quote_arg(r"C:\Program Files\App"),
        r#""C:\Program Files\App""#
    );
}

#[test]
fn quote_arg_doubles_trailing_backslashes() {
    assert_eq!(quote_arg(r"D:\My Data\"), r#""D:\My Data\\""#);
    assert_eq!(quote_arg(r"D:\a\\"), r#""D:\a\\\\""#);
}

#[test]
fn quote_arg_escapes_quotes_and_the_backslashes_before_them() {
    assert_eq!(quote_arg(r#"a"b"#), r#""a\"b""#);
    assert_eq!(quote_arg(r#"a\"b"#), r#""a\\\"b""#);
    assert_eq!(quote_arg(""), r#""""#);
}

#[test]
fn parse_rescan_args_takes_every_value_after_the_flag() {
    let parsed = parse_rescan_args(args(&[
        "--rescan", r"C:\", "--other", "--rescan", r"D:\a b",
    ]));
    assert_eq!(parsed, args(&[r"C:\", r"D:\a b"]));
}

#[test]
fn parse_rescan_args_ignores_a_flag_without_a_value() {
    assert_eq!(
        parse_rescan_args(args(&["x", "--rescan"])),
        Vec::<String>::new()
    );
    assert_eq!(parse_rescan_args(args(&[])), Vec::<String>::new());
}

#[test]
fn startup_rescans_are_taken_once() {
    let rescans = StartupRescans::from_args(args(&["--rescan", r"C:\"]));
    assert_eq!(rescans.take(), args(&[r"C:\"]));
    assert!(rescans.take().is_empty());
}

#[test]
fn both_flags_are_read_in_any_order() {
    for list in [
        &["--wait-pid", "42", "--rescan", r"C:\"][..],
        &["--rescan", r"C:\", "--wait-pid", "42"][..],
    ] {
        assert_eq!(parse_wait_pid(args(list)), Some(42));
        assert_eq!(parse_rescan_args(args(list)), args(&[r"C:\"]));
    }
}

#[test]
fn parse_wait_pid_ignores_a_bad_or_missing_pid() {
    for list in [
        &["--wait-pid", "abc"][..],
        &["--wait-pid", "-1"][..],
        &["--wait-pid", "0"][..],
        &["--wait-pid"][..],
        &[][..],
    ] {
        assert_eq!(parse_wait_pid(args(list)), None, "{list:?}");
    }
}

#[cfg(windows)]
#[test]
fn a_privilege_counts_as_enabled_only_when_fully_assigned() {
    use windows_sys::Win32::Foundation::{ERROR_NOT_ALL_ASSIGNED, ERROR_SUCCESS};
    assert!(windows::adjusted(1, ERROR_SUCCESS));
    assert!(!windows::adjusted(1, ERROR_NOT_ALL_ASSIGNED));
    assert!(!windows::adjusted(0, ERROR_SUCCESS));
}
