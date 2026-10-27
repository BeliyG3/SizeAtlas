//! A search of one folder of one root (a scope): what it takes, what it refuses, and when it is
//! the same search as the last one.

use std::fs;
use std::path::Path;
use std::sync::Arc;

use sizeatlas_core::tree::Tree;
use tempfile::TempDir;

use super::Emit;
use super::tests::{Hold, dir_named, recorder, scanned, state};
use crate::dto::ScopeDto;
use crate::error::CmdError;
use crate::recycle::fixture::{HANG, settle};
use crate::state::AppState;

/// The node at the relative path `rel` (`/`-separated) of `tree`.
fn at(tree: &Tree, rel: &str) -> u32 {
    rel.split('/').fold(0, |id, part| {
        tree.children(id).find(|&c| tree.name(c) == part).unwrap()
    })
}

/// An open root `prefix…` with a pair of copies in `f` and another pair in `g`; its folder and
/// the scopes of `f`, of `g` and of the file `f/a`.
fn open_two_pairs(state: &AppState, prefix: &str) -> (TempDir, [ScopeDto; 3]) {
    let dir = dir_named(prefix);
    let bytes: Vec<u8> = (0..8192).map(|i| (i * 7) as u8).collect();
    let other: Vec<u8> = (0..9000).map(|i| (i * 3) as u8).collect();
    for (rel, bytes) in [
        ("f/a", &bytes),
        ("f/b", &bytes),
        ("g/c", &other),
        ("g/d", &other),
    ] {
        let path = dir.path().join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        settle(&path);
    }
    let tree = scanned(dir.path());
    let root = tree.name(0).to_owned();
    let ids = [at(&tree, "f"), at(&tree, "g"), at(&tree, "f/a")];
    let generation = state.install_tree(tree);
    let scope = |folder| ScopeDto {
        root: root.clone(),
        generation,
        folder,
    };
    (dir, ids.map(scope))
}

fn find_in(state: &AppState, scope: Option<&ScopeDto>, emit: Emit) -> Result<u64, CmdError> {
    let (job, handle) = state.find_duplicates(String::new(), false, scope.cloned(), emit)?;
    handle.join().unwrap();
    Ok(job)
}

/// The full path of `rel` below the root `root`, as the tree puts it.
fn path(root: &str, rel: &str) -> String {
    Path::new(root).join(rel).display().to_string()
}

/// The folders of the first paths of every copy of the result.
fn parents(state: &AppState) -> Vec<String> {
    let dto = state.duplicates_since(0, 0);
    let mut all: Vec<String> = (dto.groups.iter())
        .flat_map(|g| &g.copies)
        .map(|c| Path::new(&c.path).parent().unwrap().display().to_string())
        .collect();
    all.sort();
    all
}

#[test]
fn a_scope_takes_only_its_root_and_folder() {
    let (state, _) = state();
    let (_a, [f, _, _]) = open_two_pairs(&state, "scope-a");
    let _b = open_two_pairs(&state, "scope-b");
    let e = state.estimate_duplicates("", false, Some(&f)).unwrap();
    assert_eq!((e.files, e.roots), (2, 1));
    assert_eq!(e.scope, Some(path(&f.root, "f")));
    find_in(&state, Some(&f), recorder().0).unwrap();
    assert_eq!(parents(&state), [path(&f.root, "f"), path(&f.root, "f")]);
    let dto = state.duplicates_since(0, 0);
    assert_eq!(dto.scope, Some(path(&f.root, "f")));
    // The other open root is not searched: it does not make the result stale.
    assert!(!dto.stale && !state.duplicates_stale());
}

#[test]
fn a_stale_scope_is_refused() {
    let (state, _) = state();
    let (_a, [f, _, file]) = open_two_pairs(&state, "stale-scope");
    let old = ScopeDto {
        generation: f.generation + 1,
        ..f.clone()
    };
    let gone = ScopeDto {
        folder: u32::MAX,
        ..f.clone()
    };
    let closed = ScopeDto {
        root: format!("{}-closed", f.root),
        ..f.clone()
    };
    for scope in [old, gone, file, closed] {
        let e = state.estimate_duplicates("", false, Some(&scope));
        assert_eq!(e.err(), Some(CmdError::StaleId), "{scope:?}");
        let found = find_in(&state, Some(&scope), recorder().0);
        assert_eq!(found.err(), Some(CmdError::StaleId), "{scope:?}");
    }
    assert_eq!(state.duplicates_since(0, 0).job, 0);
}

/// The groups seen while a search of `scope` is held at its first progress.
fn held_groups(state: &AppState, scope: &ScopeDto) -> usize {
    let (hold, at_start, go) = Hold::new();
    let hold: Emit = Arc::new(move |_| hold.wait());
    let (_, handle) =
        (state.find_duplicates(String::new(), false, Some(scope.clone()), hold)).unwrap();
    at_start.recv_timeout(HANG).unwrap();
    let groups = state.duplicates_since(0, 0).groups.len();
    go.send(()).unwrap();
    handle.join().unwrap();
    groups
}

#[test]
fn another_scope_is_a_new_search() {
    let (state, _) = state();
    let (_a, [f, g, _]) = open_two_pairs(&state, "rescope");
    find_in(&state, Some(&f), recorder().0).unwrap();
    assert_eq!(held_groups(&state, &f), 1);
    assert_eq!(held_groups(&state, &g), 0);
    find_in(&state, None, recorder().0).unwrap();
    assert_eq!(held_groups(&state, &g), 0);
}

#[test]
fn no_scope_is_unchanged() {
    let (state, _) = state();
    let (_a, [a, _, _]) = open_two_pairs(&state, "noscope-a");
    let (_b, [b, _, _]) = open_two_pairs(&state, "noscope-b");
    let e = state.estimate_duplicates("", false, None).unwrap();
    assert_eq!((e.files, e.roots, e.scope), (8, 2, None));
    find_in(&state, None, recorder().0).unwrap();
    let dto = state.duplicates_since(0, 0);
    assert_eq!((dto.groups.len(), dto.scope), (2, None));
    let mut want = Vec::new();
    for r in [&a.root, &b.root] {
        want.extend([path(r, "f"), path(r, "f"), path(r, "g"), path(r, "g")]);
    }
    want.sort();
    assert_eq!(parents(&state), want);
}

#[test]
fn a_dead_folder_is_refused() {
    let (state, _) = state();
    let dir = dir_named("dead-scope");
    for rel in ["f/a", "g/b"] {
        let path = dir.path().join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, [1; 8192]).unwrap();
        settle(&path);
    }
    let mut tree = scanned(dir.path());
    let g = at(&tree, "g");
    tree.remove(g);
    let root = tree.name(0).to_owned();
    let generation = state.install_tree(tree);
    let dead = ScopeDto {
        root,
        generation,
        folder: g,
    };
    let e = state.estimate_duplicates("", false, Some(&dead));
    assert_eq!(e.err(), Some(CmdError::StaleId));
    let found = find_in(&state, Some(&dead), recorder().0);
    assert_eq!(found.err(), Some(CmdError::StaleId));
}

#[test]
fn a_scope_on_a_root_being_scanned_checks_its_generation() {
    let (state, _) = state();
    let (_a, [f, _, _]) = open_two_pairs(&state, "scanning-scope");
    state.enqueue(f.root.clone()).unwrap();
    let e = state.estimate_duplicates("", false, Some(&f)).unwrap();
    assert_eq!(
        (e.roots, &e.skipped, e.files),
        (0, &vec![f.root.clone()], 0)
    );
    let old = ScopeDto {
        generation: f.generation + 1,
        ..f.clone()
    };
    let e = state.estimate_duplicates("", false, Some(&old));
    assert_eq!(e.err(), Some(CmdError::StaleId));
    let found = find_in(&state, Some(&old), recorder().0);
    assert_eq!(found.err(), Some(CmdError::StaleId));
}
