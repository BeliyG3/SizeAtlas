//! Deleting clean-up rows of a scanned temporary "drive" seen through an injected context: never
//! the real one, never the real trash. Items go through `fixture::deleting` or `purge::delete`.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use sizeatlas_core::cleanup::Refusal;
use sizeatlas_core::tree::ListKind;

use super::fixture::{deleting, id, link, open};
use super::membership::{BinCheck, refused, run_rows};
use super::{purge, run};
use crate::dto::TrashDto;
use crate::error::CmdError;
use crate::state::cleanup_tests::{CHROME, LOCAL, Machine, TEMP, machine};
use crate::state::{AppState, TrashItem};

const CACHE: &str = "Users/u/AppData/Local/Google/Chrome/User Data/Default/Cache";
const NODE_MODULES: &str = "Users/u/proj/node_modules";

fn cacache() -> String {
    format!("{LOCAL}/npm-cache/_cacache")
}

impl Machine {
    fn path(&self, rel: &str) -> PathBuf {
        self.tree().path(self.id(rel))
    }

    /// `rels` deleted as `trash(…, cleanup: true)` would (`bin` = `Some`) or for good (`None`),
    /// each item through `trash_one`.
    fn delete(
        &self,
        rels: &[&str],
        bin: Option<&BinCheck>,
        trash_one: impl Fn(&Path) -> Result<(), String>,
    ) -> Result<TrashDto, CmdError> {
        let ids: Vec<u32> = rels.iter().map(|rel| self.id(rel)).collect();
        let rev = self.tree().rev;
        let cache = tempfile::tempdir().unwrap();
        let ignore = |_| ();
        run_rows(
            &self.state,
            cache.path(),
            self.generation,
            rev,
            &ids,
            bin,
            trash_one,
            ignore,
        )
    }
}

fn never(path: &Path) -> Result<(), String> {
    panic!("{} must not go", path.display())
}

fn any_bin(_: &Path, _: u64) -> bool {
    true
}

#[test]
fn a_protected_name_added_after_the_scan_is_refused_right_before_deleting() {
    let m = machine();
    let row = m.path(NODE_MODULES);
    // Inside `pkg`: the row's own time stays the scanned one, only the re-check sees it.
    let secret = row.join("pkg").join(".ssh").join("id_rsa");
    fs::create_dir(secret.parent().unwrap()).unwrap();
    fs::write(&secret, b"secret").unwrap();
    for bin in [Some(&any_bin as &BinCheck), None] {
        let done = m.delete(&[NODE_MODULES], bin, never).unwrap();
        assert_eq!(done.removed, 0);
        assert_eq!(done.failed.len(), 1);
        assert_eq!(done.failed[0].error, CmdError::Protected);
    }
    assert!(secret.exists());
}

#[test]
fn a_temp_row_touched_an_hour_ago_has_changed() {
    let m = machine();
    let old = m.path(&format!("{TEMP}/old"));
    assert!(names(&m, ListKind::Cleanup).contains(&"old".to_owned()));
    File::options()
        .write(true)
        .open(old.join("a.bin"))
        .unwrap()
        .set_modified(SystemTime::now() - Duration::from_secs(3600))
        .unwrap();
    let done = m.delete(&[&format!("{TEMP}/old")], None, never).unwrap();
    assert_eq!(done.failed[0].error, CmdError::Changed);
    assert!(old.join("a.bin").exists());
}

#[test]
fn an_id_that_is_no_row_refuses_the_whole_request() {
    let m = machine();
    let log = Mutex::new(Vec::new());
    let package = "Users/u/proj/package.json";
    for bin in [Some(&any_bin as &BinCheck), None] {
        assert_eq!(
            m.delete(&[CACHE, package], bin, deleting(&log)),
            Err(CmdError::Protected)
        );
        assert_eq!(
            m.delete(&["pagefile.sys"], bin, deleting(&log)),
            Err(CmdError::Protected),
            "an info place"
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
    let bin = Some(&any_bin as &BinCheck);
    assert_eq!(m.delete(&[CACHE], bin, never), Err(CmdError::Protected));
    assert_eq!(m.delete(&[CACHE], None, never), Err(CmdError::Protected));
    assert!(m.path(CACHE).exists());
    assert!(
        m.path(&format!("{CHROME}/Cache/data_1")).exists(),
        "the list's cached walk is never used"
    );
}

#[test]
fn a_row_the_bin_cannot_take_stays() {
    let m = machine();
    let no_room = |_: &Path, _: u64| false;
    let done = m.delete(&[CACHE], Some(&no_room), never).unwrap();
    assert_eq!((done.removed, done.failed.len()), (0, 1));
    assert_eq!(done.failed[0].error, CmdError::NoTrash);
    assert!(m.path(CACHE).exists(), "never deleted for good");
}

#[test]
fn rows_deleted_for_good_leave_the_disk_and_the_tree() {
    let m = machine();
    let (cache, npm) = (m.path(CACHE), m.path(&cacache()));
    let before = m.tree().node(0).size;
    let size = m.size(CACHE) + m.size(&cacache());
    let done = m.delete(&[CACHE, &cacache()], None, purge::delete).unwrap();
    assert_eq!(
        (done.removed, done.failed, done.stopped),
        (2, vec![], false)
    );
    assert!(!cache.exists() && !npm.exists());
    assert_eq!(m.tree().node(0).size, before - size);
}

#[test]
fn a_link_inside_a_row_goes_as_a_link_and_its_target_stays() {
    let m = machine();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("keep.txt"), b"keep").unwrap();
    let row = m.path(NODE_MODULES);
    if !link(outside.path(), &row.join("pkg").join("linked")) {
        eprintln!("skipped: no directory link here");
        return;
    }
    let done = m.delete(&[NODE_MODULES], None, purge::delete).unwrap();
    assert_eq!((done.removed, done.failed), (1, vec![]));
    assert!(!row.exists());
    assert_eq!(fs::read(outside.path().join("keep.txt")).unwrap(), b"keep");
}

#[test]
fn a_stop_between_items_leaves_the_rest() {
    let m = machine();
    let state = m.state.clone();
    let paths = [m.path(CACHE), m.path(&cacache())];
    let stop_after = |path: &Path| {
        state.stop_trash();
        purge::delete(path)
    };
    let done = m.delete(&[CACHE, &cacache()], None, stop_after).unwrap();
    assert_eq!((done.removed, done.failed, done.stopped), (1, vec![], true));
    assert_eq!(paths.iter().filter(|p| p.exists()).count(), 1);
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
    assert_eq!(refused(Refusal::Protected), CmdError::Protected);
    assert_eq!(refused(Refusal::Changed), CmdError::Changed);
    assert_eq!(
        refused(Refusal::NoAccess(
            path.clone(),
            error(io::ErrorKind::NotFound)
        )),
        CmdError::Changed,
        "gone meanwhile"
    );
    assert_eq!(
        refused(Refusal::NoAccess(
            path.clone(),
            error(io::ErrorKind::PermissionDenied)
        )),
        CmdError::NoAccess { path: "x".into() }
    );
    assert!(matches!(
        refused(Refusal::NoAccess(path, error(io::ErrorKind::Other))),
        CmdError::Io { .. }
    ));
}

fn names(m: &Machine, kind: ListKind) -> Vec<String> {
    let list = m.state.list(m.generation, 0, kind, 100, None).unwrap();
    list.items.into_iter().map(|i| i.item.name).collect()
}
