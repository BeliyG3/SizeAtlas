//! The walk behind the clean-up lists: shared between calls until the tree changes, built only
//! for the two modes, blind in the tests' default state; and the info lines made from it.

use std::path::Path;
use std::sync::atomic::Ordering;

use sizeatlas_core::cleanup::{Cleanup, Info, Mode};
use sizeatlas_core::tree::{ListKind, Tree};

use super::cleanup_rows;
use super::cleanup_tests::{CHROME, TEMP, info, machine, names};
use crate::dto::{FoundDto, InfoKind};
use crate::state::AppState;

#[test]
fn lists_share_one_walk_until_the_tree_changes() {
    let m = machine();
    let calls = || m.calls.load(Ordering::Relaxed);
    let first = m.list("", ListKind::Cleanup, 10);
    m.list(TEMP, ListKind::Review, 10);
    m.list(TEMP, ListKind::Cleanup, 10);
    assert_eq!(calls(), 1, "both modes and any folder read the same walk");
    m.running.lock().unwrap().push("chrome.exe");
    assert_eq!(
        m.list("", ListKind::Cleanup, 10),
        first,
        "within the window"
    );

    m.bump();
    let after = m.list("", ListKind::Cleanup, 10);
    assert_eq!(calls(), 2, "a new rev walks again");
    assert_eq!(after.rev, first.rev + 1);
    assert_eq!(names(&after), ["old", "_cacache"]);
}

#[test]
fn the_default_state_of_tests_sees_nothing() {
    let m = machine();
    let state = AppState::default();
    let ctx = (state.0.context)(Path::new("."));
    assert!(ctx.known.home.is_empty() && ctx.known.temp.is_empty() && ctx.running.is_empty());
    assert!(!ctx.recyclable);
    let generation = state.install_tree(Tree::clone(&m.tree()));
    for kind in [ListKind::Cleanup, ListKind::Review] {
        let list = state.list(generation, 0, kind, 10, None).unwrap();
        assert!(list.items.is_empty(), "{kind:?}");
        assert_eq!(info(&list), [], "{kind:?}");
    }
    assert!(
        !m.list("", ListKind::Review, 10).items.is_empty(),
        "control"
    );
}

#[test]
fn only_the_clean_up_modes_build_the_context() {
    let m = machine();
    let largest = m.list("", ListKind::Largest, 10);
    assert_eq!((largest.found, largest.cleanup), (None, None));
    assert!(largest.items.iter().all(|i| i.reason.is_none()));
    assert_eq!(m.calls.load(Ordering::Relaxed), 0);
    m.list("", ListKind::Review, 10);
    assert_eq!(m.calls.load(Ordering::Relaxed), 1);
    assert_eq!(
        m.state
            .list(m.generation + 1, 0, ListKind::Cleanup, 10, None)
            .map(|_| ()),
        Err(crate::error::CmdError::StaleId)
    );
}

#[test]
fn info_lines_are_never_repeated_and_unreadable_places_make_it_approximate() {
    let m = machine();
    let (temp, old) = (m.id(TEMP), m.id(&format!("{TEMP}/old")));
    let cache = m.id(&format!("{CHROME}/Cache"));
    let no_access = |id| Info::NoAccess {
        id,
        path: String::new(),
        spot: false,
    };
    // On the way to an info spot: Cleanup info only, never "approximate".
    let spot = |id| Info::NoAccess {
        id,
        path: String::new(),
        spot: true,
    };
    let held = |mode| Info::AppRunning {
        app: "Google Chrome",
        mode,
        ids: vec![cache],
        size: 0,
    };
    let all = Cleanup {
        info: vec![
            no_access(old),
            no_access(old),
            no_access(m.id("pagefile.sys")),
            spot(m.id("pagefile.sys")),
            spot(temp),
            held(Mode::Cleanup),
            held(Mode::Review),
        ],
        ..Cleanup::default()
    };
    let (items, truncated, found, cleanup) =
        cleanup_rows(&m.tree(), 0, Mode::Cleanup, 10, &all, None);
    assert!(items.is_empty() && !truncated);
    assert_eq!(found, FoundDto { count: 0, size: 0 });
    let kinds: Vec<InfoKind> = cleanup.info.iter().map(|i| i.kind).collect();
    assert_eq!(
        kinds,
        [
            InfoKind::NoAccess,
            InfoKind::NoAccess,
            InfoKind::NoAccess,
            InfoKind::AppRunning
        ],
        "old, the pagefile once, Temp"
    );
    assert!(cleanup.approximate);

    let spots = Cleanup {
        info: vec![spot(temp)],
        ..Cleanup::default()
    };
    let (.., review) = cleanup_rows(&m.tree(), 0, Mode::Review, 10, &spots, None);
    assert_eq!(review.info, []);
    assert!(!review.approximate);
    let (.., cleanup) = cleanup_rows(&m.tree(), 0, Mode::Cleanup, 10, &spots, None);
    assert_eq!(cleanup.info.len(), 1);
    assert!(!cleanup.approximate, "spot places are in no total");

    let (.., cleanup) = cleanup_rows(&m.tree(), temp, Mode::Review, 10, &all, None);
    let paths: Vec<_> = cleanup.info.iter().map(|i| i.path.clone()).collect();
    assert_eq!(
        paths,
        [Some(m.tree().path(old).to_string_lossy().into_owned())]
    );
    assert!(cleanup.approximate);
    let (.., cleanup) = cleanup_rows(
        &m.tree(),
        cache,
        Mode::Review,
        10,
        &Cleanup::default(),
        None,
    );
    assert!(!cleanup.approximate);
}
