//! The three times of a Temp row in the re-check, and the change time reader.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::recheck_tests::{DAY, check, file, later, now, temp};
use super::*;
use crate::platform::change_time;

const DAY_NS: i64 = 86_400 * 1_000_000_000;

/// A Temp row of one file with these modification and creation times (creation on Windows only;
/// elsewhere it stays now). Setting them makes its change time now.
fn aged(dir: &Path, modified: SystemTime, created: SystemTime) -> PathBuf {
    let path = dir.join("unpacked.txt");
    file(&path);
    let times = fs::FileTimes::new().set_modified(modified);
    #[cfg(windows)]
    let times = std::os::windows::fs::FileTimesExt::set_created(times, created);
    #[cfg(not(windows))]
    let _ = created;
    let open = fs::File::options().write(true).open(&path).unwrap();
    open.set_times(times).unwrap();
    path
}

fn days(n: i64) -> SystemTime {
    let span = DAY * n.unsigned_abs() as u32;
    if n < 0 {
        SystemTime::now() - span
    } else {
        SystemTime::now() + span
    }
}

#[test]
fn each_of_the_three_times_can_make_a_temp_row_young() {
    let in_10_days = now() + 10 * DAY_NS;
    let (_a, root) = temp();
    let old = aged(&root, days(-30), days(-30));
    assert!(matches!(check(&old, Reason::TempOld, in_10_days), Ok(())));
    assert!(
        matches!(
            check(&old, Reason::TempOld, now() + 3 * DAY_NS),
            Err(Refusal::Changed)
        ),
        "changed 3 days before"
    );

    let (_b, root) = temp();
    let modified = aged(&root, days(20), days(-30));
    for reason in [Reason::TempOld, Reason::TempLarge, Reason::TempWork] {
        assert!(
            matches!(check(&modified, reason, in_10_days), Err(Refusal::Changed)),
            "modified in the future, {reason:?}"
        );
    }
    assert!(
        matches!(check(&modified, Reason::NodeModules, now()), Ok(())),
        "only Temp rows check the age"
    );

    #[cfg(windows)]
    {
        let (_c, root) = temp();
        let created = aged(&root, days(-30), days(20));
        assert!(
            matches!(
                check(&created, Reason::TempOld, in_10_days),
                Err(Refusal::Changed)
            ),
            "created in the future"
        );
    }
}

#[test]
fn a_time_before_the_epoch_is_unknown_and_young() {
    let (_dir, root) = temp();
    let path = aged(&root, UNIX_EPOCH - DAY * 3650, days(-30));
    assert!(matches!(
        check(&path, Reason::TempOld, later()),
        Err(Refusal::Changed)
    ));
}

#[test]
fn the_change_time_of_a_new_file_is_now() {
    let (_dir, root) = temp();
    let path = root.join("a");
    file(&path);
    let changed = change_time(&path).unwrap();
    assert!((now() - changed).abs() < 3_600 * 1_000_000_000, "{changed}");
    assert!(change_time(&root.join("missing")).is_err());
}

#[test]
fn a_deep_entry_is_read_past_the_old_path_limit() {
    let (_dir, root) = temp();
    let row = root.join("deep");
    let mut path = row.clone();
    while path.as_os_str().len() < 300 {
        path.push("a-long-folder-name-0123456789");
    }
    path.push("f.txt");
    file(&path);
    assert!(change_time(&path).is_ok());
    assert!(matches!(check(&row, Reason::TempOld, later()), Ok(())));
}
