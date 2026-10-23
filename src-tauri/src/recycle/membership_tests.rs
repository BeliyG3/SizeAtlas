//! Clean-up requests refused, whole or per item, on a scanned temporary "drive" seen through an
//! injected context: never the real one, never the real trash (items go through stand-ins or
//! `purge::delete`, inside the temporary folder).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use sizeatlas_core::cleanup::Refusal;
use sizeatlas_core::tree::ListKind;

use super::fixture::{deleting, id, open};
use super::membership::{Disposal, TrashOne, refused, run_rows};
use super::run;
use crate::dto::{TrashDto, TrashProgressDto};
use crate::error::CmdError;
use crate::state::cleanup_tests::{CHROME, LOCAL, Machine, TEMP, machine};
use crate::state::{AppState, TrashItem};

pub(super) const CACHE: &str = "Users/u/AppData/Local/Google/Chrome/User Data/Default/Cache";
pub(super) const NODE_MODULES: &str = "Users/u/proj/node_modules";

pub(super) fn cacache() -> String {
    format!("{LOCAL}/npm-cache/_cacache")
}

impl Machine {
    pub(super) fn path(&self, rel: &str) -> PathBuf {
        self.tree().path(self.id(rel))
    }

    /// `rels` deleted as `disposal` says, with `report` getting the progress.
    pub(super) fn run(
        &self,
        rels: &[&str],
        disposal: Disposal,
        report: impl FnMut(TrashProgressDto),
    ) -> Result<TrashDto, CmdError> {
        let ids: Vec<u32> = rels.iter().map(|rel| self.id(rel)).collect();
        let rev = self.tree().rev;
        let cache = tempfile::tempdir().unwrap();
        let state = &self.state;
        run_rows(
            state,
            cache.path(),
            self.generation,
            rev,
            &ids,
            disposal,
            report,
        )
    }

    pub(super) fn delete(&self, rels: &[&str], disposal: Disposal) -> Result<TrashDto, CmdError> {
        self.run(rels, disposal, |_| ())
    }
}

pub(super) fn never(path: &Path) -> Result<(), String> {
    panic!("{} must not go", path.display())
}

pub(super) fn any_bin(_: &Path, _: u64) -> bool {
    true
}

/// As `trash(…, cleanup: true)` with a bin that takes anything and `trash_one`.
pub(super) fn to_trash<'a>(trash_one: &'a TrashOne<'a>) -> Disposal<'a> {
    Disposal::Trash {
        bin: &any_bin,
        trash_one,
    }
}

#[test]
fn a_protected_name_added_after_the_scan_is_refused_right_before_deleting() {
    let m = machine();
    let row = m.path(NODE_MODULES);
    // Inside `pkg`: the row's own time stays the scanned one, only the re-check sees it.
    let secret = row.join("pkg").join(".ssh").join("id_rsa");
    fs::create_dir(secret.parent().unwrap()).unwrap();
    fs::write(&secret, b"secret").unwrap();
    for disposal in [to_trash(&never), Disposal::Purge] {
        let done = m.delete(&[NODE_MODULES], disposal).unwrap();
        assert_eq!(done.removed, 0);
        assert_eq!(done.failed.len(), 1);
        assert_eq!(done.failed[0].error, CmdError::Protected);
    }
    assert!(secret.exists());
}

/// Files made by a test are young by their change time, which cannot be set back; the core's
/// `each_of_the_three_times_can_make_a_temp_row_young` checks each of the three times.
#[test]
fn a_temp_row_young_on_disk_has_changed() {
    let m = machine();
    let old = m.path(&format!("{TEMP}/old"));
    assert!(names(&m, ListKind::Cleanup).contains(&"old".to_owned()));
    for disposal in [to_trash(&never), Disposal::Purge] {
        let done = m.delete(&[&format!("{TEMP}/old")], disposal).unwrap();
        assert_eq!(done.failed[0].error, CmdError::Changed);
    }
    assert!(old.join("a.bin").exists());
}

#[test]
fn an_id_that_is_no_row_refuses_the_whole_request() {
    let m = machine();
    let log = Mutex::new(Vec::new());
    let deletes = deleting(&log);
    let package = "Users/u/proj/package.json";
    for purge in [false, true] {
        let disposal = || {
            if purge {
                Disposal::Purge
            } else {
                to_trash(&deletes)
            }
        };
        assert_eq!(
            m.delete(&[CACHE, package], disposal()),
            Err(CmdError::Protected)
        );
        assert_eq!(
            m.delete(&["pagefile.sys"], disposal()),
            Err(CmdError::Protected),
            "an info place"
        );
        // The row goes with the folder that holds it, and that folder is no row.
        assert_eq!(
            m.delete(&["Users/u", CACHE], disposal()),
            Err(CmdError::Protected)
        );
    }
    assert!(log.lock().unwrap().is_empty(), "nothing went");
    assert!(m.path(CACHE).exists() && m.path(package).exists());
}

#[test]
fn a_browser_started_after_listing_refuses_its_rows() {
    let m = machine();
    assert!(names(&m, ListKind::Cleanup).contains(&"Cache".to_owned()));
    m.running.lock().unwrap().push("chrome.exe");
    let refused = Err(CmdError::Protected);
    assert_eq!(m.delete(&[CACHE], to_trash(&never)), refused);
    assert_eq!(m.delete(&[CACHE], Disposal::Purge), refused);
    assert!(
        m.path(&format!("{CHROME}/Cache/data_1")).exists(),
        "the list's cached walk is never used"
    );
}

#[test]
fn a_row_the_bin_cannot_take_stays() {
    let m = machine();
    let no_room = |_: &Path, _: u64| false;
    let disposal = Disposal::Trash {
        bin: &no_room,
        trash_one: &never,
    };
    let done = m.delete(&[CACHE], disposal).unwrap();
    assert_eq!((done.removed, done.failed.len()), (0, 1));
    assert_eq!(done.failed[0].error, CmdError::NoTrash);
    assert!(m.path(CACHE).exists(), "never deleted for good");
}

#[test]
fn a_stop_during_the_walk_of_a_row_leaves_it() {
    let m = machine();
    let state = m.state.clone();
    // The first progress comes after the loop's own stop check, right before the re-check.
    let stop = |_: TrashProgressDto| state.stop_trash();
    let done = m.run(&[CACHE], to_trash(&never), stop).unwrap();
    assert_eq!((done.removed, done.failed, done.stopped), (0, vec![], true));
    assert!(m.path(CACHE).exists());
}

#[test]
fn a_refusal_while_stopping_counts_as_stopped() {
    let state = AppState::default();
    let (_dir, generation) = open(&state);
    let cache = tempfile::tempdir().unwrap();
    let ids = [
        id(&state, generation, &["top.bin"]),
        id(&state, generation, &["sub"]),
    ];
    // As the re-check gives up when a stop is asked.
    let stopping = |_: &TrashItem| {
        state.stop_trash();
        Err(refused(Refusal::Stopped))
    };
    let done = run(&state, cache.path(), generation, 0, &ids, stopping, never).unwrap();
    assert_eq!((done.removed, done.failed, done.stopped), (0, vec![], true));
}

#[test]
fn refusals_map_to_the_errors_of_the_ui() {
    let path = PathBuf::from("x");
    let error = |kind| io::Error::new(kind, "e");
    let no_access = |kind| refused(Refusal::NoAccess(path.clone(), error(kind)));
    assert_eq!(refused(Refusal::Protected), CmdError::Protected);
    assert_eq!(refused(Refusal::Changed), CmdError::Changed);
    assert_eq!(
        no_access(io::ErrorKind::NotFound),
        CmdError::Changed,
        "gone meanwhile"
    );
    assert_eq!(
        no_access(io::ErrorKind::PermissionDenied),
        CmdError::NoAccess { path: "x".into() }
    );
    assert!(matches!(
        no_access(io::ErrorKind::Other),
        CmdError::Io { .. }
    ));
}

fn names(m: &Machine, kind: ListKind) -> Vec<String> {
    let list = m.state.list(m.generation, 0, kind, 100, None).unwrap();
    list.items.into_iter().map(|i| i.item.name).collect()
}
