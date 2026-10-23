//! The re-check before deleting, on real files inside `tempfile` folders. The guard is built
//! from an injected `Known`, never from the real environment (`tempfile` lies in the real
//! `%TEMP%` on Windows).

use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tempfile::TempDir;

use super::*;
use crate::scanner::epoch_nanos;

/// The Windows tables with an empty `Known` hold only the anywhere names; the Linux ones would
/// block `/tmp`, where `tempfile` lives.
const OS: Os = Os::Windows;
pub(super) const DAY: Duration = Duration::from_secs(86_400);

/// A temporary folder and its canonical path: the re-check refuses a row below a link, and the
/// macOS temporary folder lies below the `/var` link.
pub(super) fn temp() -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dunce::canonicalize(dir.path()).unwrap();
    (dir, path)
}

pub(super) fn now() -> i64 {
    epoch_nanos(SystemTime::now())
}

/// A month from now: every time read in the walk is old.
pub(super) fn later() -> i64 {
    now() + 30 * 86_400 * 1_000_000_000
}

fn never() -> bool {
    false
}

pub(super) fn check(path: &Path, reason: Reason, now_ns: i64) -> Result<(), Refusal> {
    let known = Known::default();
    recheck(path, reason, &Guard::new(OS, &known), now_ns, &never)
}

pub(super) fn file(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, b"x").unwrap();
}

/// A directory link at `link` to `target`: a junction on Windows, a symlink on Unix. `false`
/// when the system does not allow it here.
fn link(target: &Path, link: &Path) -> bool {
    #[cfg(windows)]
    return std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .is_ok_and(|out| out.status.success());
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, link).is_ok();
}

#[test]
fn a_link_inside_a_row_is_a_leaf_and_its_target_is_never_listed() {
    let (_dir, root) = temp();
    let secrets = root.join("secrets");
    file(&secrets.join("id_rsa"));
    file(&secrets.join("model.gguf"));
    let row = root.join("row");
    file(&row.join("a.tmp"));
    if !link(&secrets, &row.join("link")) {
        eprintln!("skipped: cannot create a directory link");
        return;
    }
    assert!(matches!(check(&row, Reason::TempOld, later()), Ok(())));
    assert!(
        matches!(
            check(&secrets, Reason::TempOld, later()),
            Err(Refusal::Protected)
        ),
        "the target itself holds a protected name"
    );
}

#[test]
fn a_row_replaced_by_a_link_has_changed() {
    let (_dir, root) = temp();
    let target = root.join("target");
    file(&target.join("a.tmp"));
    let row = root.join("row");
    if !link(&target, &row) {
        eprintln!("skipped: cannot create a directory link");
        return;
    }
    assert!(matches!(
        check(&row, Reason::TempOld, later()),
        Err(Refusal::Changed)
    ));
}

#[test]
fn a_row_below_a_link_has_changed() {
    let (_dir, root) = temp();
    let row = root.join("target").join("row");
    file(&row.join("a.tmp"));
    assert!(matches!(check(&row, Reason::NodeModules, now()), Ok(())));
    let linked = root.join("link");
    if !link(&root.join("target"), &linked) {
        eprintln!("skipped: cannot create a directory link");
        return;
    }
    assert!(matches!(
        check(&linked.join("row"), Reason::NodeModules, now()),
        Err(Refusal::Changed)
    ));
}

#[test]
fn a_protected_name_added_after_the_scan_is_refused() {
    let (_dir, root) = temp();
    let row = root.join("node_modules");
    file(&row.join("pkg").join("index.js"));
    assert!(matches!(check(&row, Reason::NodeModules, now()), Ok(())));
    fs::create_dir_all(row.join("pkg").join(".ssh")).unwrap();
    assert!(matches!(
        check(&row, Reason::NodeModules, now()),
        Err(Refusal::Protected)
    ));
}

#[test]
fn the_guard_refuses_a_temp_exclusion() {
    let (_dir, root) = temp();
    let row = root.join("claude-work");
    file(&row.join("a.tmp"));
    let known = Known {
        temp: root.to_string_lossy().into_owned(),
        ..Known::default()
    };
    let guard = Guard::new(OS, &known);
    let other = root.join("old");
    file(&other.join("a.tmp"));
    assert!(matches!(
        recheck(&other, Reason::TempOld, &guard, later(), &never),
        Ok(())
    ));
    assert!(matches!(
        recheck(&row, Reason::TempOld, &guard, later(), &never),
        Err(Refusal::Protected)
    ));
}

#[test]
fn bytecode_must_still_be_only_bytecode() {
    let (_dir, root) = temp();
    let row = root.join("__pycache__");
    file(&row.join("a.cpython-312.pyc"));
    file(&row.join("b.pyo"));
    assert!(matches!(check(&row, Reason::PythonBytecode, now()), Ok(())));
    file(&row.join("c.py"));
    assert!(matches!(
        check(&row, Reason::PythonBytecode, now()),
        Err(Refusal::Changed)
    ));
}

#[test]
fn a_work_marker_refuses_an_old_temp_row_but_not_a_work_row() {
    let (_dir, root) = temp();
    let row = root.join("old");
    file(&row.join("deep").join("scene.blend"));
    assert!(matches!(
        check(&row, Reason::TempOld, later()),
        Err(Refusal::Protected)
    ));
    assert!(matches!(check(&row, Reason::TempWork, later()), Ok(())));
}

#[cfg(unix)]
#[test]
fn an_unreadable_folder_is_refused() {
    use std::os::unix::fs::PermissionsExt;
    let (_dir, root) = temp();
    let row = root.join("row");
    let locked = row.join("locked");
    file(&locked.join("a"));
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    let readable = fs::read_dir(&locked).is_ok(); // root reads anything
    let result = check(&row, Reason::NodeModules, now());
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    if readable {
        eprintln!("skipped: running as root");
        return;
    }
    assert!(matches!(result, Err(Refusal::NoAccess(path, _)) if path == locked));
}

#[cfg(windows)]
#[test]
fn offline_content_is_refused() {
    let (_dir, root) = temp();
    let row = root.join("row");
    let path = row.join("a");
    file(&path);
    assert!(matches!(check(&row, Reason::AppCache, now()), Ok(())));
    let set = std::process::Command::new("attrib")
        .arg("+O")
        .arg(&path)
        .output()
        .is_ok_and(|out| out.status.success());
    if !set {
        eprintln!("skipped: cannot set the offline attribute");
        return;
    }
    assert!(matches!(
        check(&row, Reason::AppCache, now()),
        Err(Refusal::Protected)
    ));
}

#[test]
fn a_missing_row_and_a_stop_are_refused() {
    let (_dir, root) = temp();
    let missing = root.join("missing");
    assert!(matches!(
        check(&missing, Reason::AppCache, now()),
        Err(Refusal::NoAccess(path, _)) if path == missing
    ));
    let row = root.join("row");
    file(&row.join("a"));
    let known = Known::default();
    let guard = Guard::new(OS, &known);
    assert!(matches!(
        recheck(&row, Reason::AppCache, &guard, now(), &|| true),
        Err(Refusal::Stopped)
    ));
}

#[test]
fn a_long_flat_folder_can_be_stopped() {
    let (_dir, root) = temp();
    let row = root.join("flat");
    fs::create_dir(&row).unwrap();
    for i in 0..1000 {
        fs::write(row.join(i.to_string()), b"").unwrap();
    }
    let known = Known::default();
    let guard = Guard::new(OS, &known);
    let calls = Cell::new(0);
    // Asked once for the folder, then again within the first thousand entries.
    let stop = || {
        calls.set(calls.get() + 1);
        calls.get() > 1
    };
    assert!(matches!(
        recheck(&row, Reason::AppCache, &guard, now(), &stop),
        Err(Refusal::Stopped)
    ));
}
