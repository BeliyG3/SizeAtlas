//! A search of one folder with the roots open inside it, and the trash of its result: copies
//! stay with their own root, and only the searched roots make the result stale.

use std::path::Path;

use super::tests::recorder;
use super::trash_fixture::{Dups, at};
use crate::dto::ScopeDto;
use crate::error::CmdError;

/// The scope of the folder `rel` of the open root `root`.
fn scope(t: &Dups, root: &str, rel: &str) -> ScopeDto {
    let trees = t.state.open_trees();
    let (generation, tree) = trees.iter().find(|(_, t)| t.name(0) == root).unwrap();
    ScopeDto {
        root: root.to_owned(),
        generation: *generation,
        folder: tree.find_path(&at(root, rel)).unwrap(),
    }
}

/// A search of `scope` with no query, run to its end.
fn find_in(t: &Dups, scope: &ScopeDto) {
    let (emit, _) = recorder();
    let (_, handle) = (t.state)
        .find_duplicates(String::new(), false, Some(scope.clone()), emit)
        .unwrap();
    handle.join().unwrap();
}

/// The generation of the open root `root`.
fn generation(t: &Dups, root: &str) -> u64 {
    let trees = t.state.open_trees();
    trees.iter().find(|(_, t)| t.name(0) == root).unwrap().0
}

#[test]
fn inner_roots_inside_the_scope_keep_their_copies() {
    let t = Dups::new();
    let files = [("f/x", 1), ("f/y", 1), ("f/sub/c", 2), ("f/sub/d", 2)];
    let (dir, a) = t.root("a", &files);
    let inner = t.open(&dir.path().join("f").join("sub"));
    let (_b, _) = t.root("b", &[("x", 1)]);
    let s = scope(&t, &a, "f");
    let e = t.state.estimate_duplicates("", false, Some(&s)).unwrap();
    assert_eq!((e.files, e.roots), (4, 2));
    find_in(&t, &s);
    let dto = t.dto();
    assert!(!dto.stale);
    assert_eq!(dto.groups.len(), 2);
    for g in &dto.groups {
        // Each file once, by the root it belongs to: the inner root's are not `a`'s too.
        assert_eq!(g.copies.len(), 2, "{}", g.name);
        let (root, gen_) = if g.name == "c" || g.name == "d" {
            (&inner, generation(&t, &inner))
        } else {
            (&a, generation(&t, &a))
        };
        for c in &g.copies {
            assert_eq!((&c.refs[0].root, c.refs[0].generation), (root, gen_));
            assert_eq!(c.refs.len(), 1);
        }
    }
    // The root outside the folder was not taken, so its volume was not asked.
    let mut volumes = t.state.0.duplicates.inner.lock().unwrap().volumes.clone();
    volumes.sort();
    assert_eq!(volumes, ["a", "sub"]);
}

#[test]
fn a_scoped_result_goes_stale_with_its_roots() {
    let t = Dups::new();
    let files = [("f/x", 1), ("f/y", 1), ("f/sub/c", 2), ("f/sub/d", 2)];
    let (dir, a) = t.root("a", &files);
    let sub = dir.path().join("f").join("sub");
    t.open(&sub);
    find_in(&t, &scope(&t, &a, "f"));
    let refs = t.refs(&[at(&a, "f/y")]);
    t.open(dir.path());
    assert!(t.dto().stale);
    let refused = super::trash::confirm(&t.state, 1, &refs).map(|_| ());
    assert_eq!(refused.err(), Some(CmdError::StaleId));
    // An inner root searched with it counts too.
    find_in(&t, &scope(&t, &a, "f"));
    assert!(!t.dto().stale);
    t.open(&sub);
    assert!(t.dto().stale);
    assert!(t.logged().is_empty());
}

#[test]
fn a_scoped_trash_goes_through_with_another_root_open() {
    let t = Dups::new();
    let (_a, a) = t.root("a", &[("f/x", 1), ("f/y", 1)]);
    let (_b, _) = t.root("b", &[("x", 1)]);
    find_in(&t, &scope(&t, &a, "f"));
    let (_c, _) = t.root("c", &[("x", 1)]);
    let y = at(&a, "f/y");
    t.trash(1, std::slice::from_ref(&y)).unwrap();
    assert_eq!(t.logged(), [y]);
    assert!(Path::new(&at(&a, "f/x")).exists());
}
