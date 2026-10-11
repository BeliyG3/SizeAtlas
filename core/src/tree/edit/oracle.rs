//! The oracle: random edits of a tree, compared with a tree built from scratch out of the same
//! folders.

use std::collections::VecDeque;

use super::tests::{META, file};
use crate::tree::{DirRec, ListKind, ListOrder, NO_PARENT, Tree, flags};

struct Lcg(u64);

impl Lcg {
    fn below(&mut self, bound: u32) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        ((self.0 >> 33) % u64::from(bound)) as u32
    }
}

/// A folder of the model the oracle edits alongside the tree; names are unique in the model.
#[derive(Clone)]
struct Folder {
    name: String,
    mtime: i64,
    unreadable: bool,
    files: Vec<(String, u64)>,
    folders: Vec<Folder>,
}

impl Folder {
    fn random(rng: &mut Lcg, next: &mut u32, name: String, depth: u32) -> Folder {
        let mut fresh = |prefix: &str| {
            *next += 1;
            format!("{prefix}{next}")
        };
        let files = (0..rng.below(4))
            .map(|_| (fresh("f"), u64::from(rng.below(1000))))
            .collect();
        let names: Vec<String> = (0..if depth < 4 { rng.below(3) } else { 0 })
            .map(|_| fresh("d"))
            .collect();
        let folders = names
            .into_iter()
            .map(|n| Folder::random(rng, next, n, depth + 1))
            .collect();
        Folder {
            name,
            mtime: i64::from(rng.below(100)),
            unreadable: rng.below(8) == 0,
            files,
            folders,
        }
    }

    /// Records of a scan of this folder, as a scanner sends them: this folder is record 0.
    fn records(&self) -> Vec<DirRec> {
        let mut out = Vec::new();
        let mut queue = VecDeque::from([(self, NO_PARENT)]);
        while let Some((folder, parent)) = queue.pop_front() {
            let id = out.len() as u32;
            out.push(DirRec {
                id,
                parent,
                name: folder.name.clone().into(),
                mtime: folder.mtime,
                flags: if folder.unreadable {
                    flags::ACCESS_ERROR
                } else {
                    0
                },
                files: folder.files.iter().map(|(n, s)| file(n, *s)).collect(),
            });
            queue.extend(folder.folders.iter().map(|f| (f, id)));
        }
        out
    }

    /// The folder at `path` (names below this one).
    fn at(&mut self, path: &[String]) -> &mut Folder {
        path.iter().fold(self, |folder, name| {
            folder
                .folders
                .iter_mut()
                .find(|f| &f.name == name)
                .expect("the model has the folder")
        })
    }

    /// Takes the file or folder at `path` out of the model.
    fn remove(&mut self, path: &[String]) {
        let (name, parent) = path.split_last().expect("not the root");
        let parent = self.at(parent);
        parent.files.retain(|(n, _)| n != name);
        parent.folders.retain(|f| &f.name != name);
    }
}

/// The edited tree holds the same items with the same totals and order as one built from scratch.
fn same_tree(actual: &Tree, expected: &Tree, at: &str) {
    actual.check_structure().unwrap();
    actual.assert_invariants();
    assert_eq!(
        (actual.live, actual.access_errors),
        (expected.live, expected.access_errors),
        "{at}: live nodes and unreadable folders"
    );
    let page = |t: &Tree, id| t.children_page(id, 0, u32::MAX, ListOrder::DEFAULT).items;
    let mut pairs = vec![(0u32, 0u32)];
    while let Some((a, e)) = pairs.pop() {
        let (na, ne) = (actual.node(a), expected.node(e));
        let where_ = actual.path(a);
        assert_eq!(
            (na.size, na.files, na.len, na.dirs, na.mtime, na.flags),
            (ne.size, ne.files, ne.len, ne.dirs, ne.mtime, ne.flags),
            "{at}: {}",
            where_.display()
        );
        let (ca, ce) = (page(actual, a), page(expected, e));
        let names = |t: &Tree, ids: &[u32]| {
            ids.iter()
                .map(|&c| t.name(c).to_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            names(actual, &ca),
            names(expected, &ce),
            "{at}: children of {}",
            where_.display()
        );
        pairs.extend(ca.into_iter().zip(ce));
    }
    let paths = |t: &Tree| {
        t.list(0, ListKind::Empty, usize::MAX)
            .items
            .into_iter()
            .map(|id| t.path(id))
            .collect::<Vec<_>>()
    };
    assert_eq!(paths(actual), paths(expected), "{at}: empty items by path");
    let sizes = |t: &Tree| {
        t.list(0, ListKind::Largest, usize::MAX)
            .items
            .into_iter()
            .map(|id| t.node(id).size)
            .collect::<Vec<_>>()
    };
    assert_eq!(sizes(actual), sizes(expected), "{at}: largest items");
}

#[test]
fn random_edits_match_a_tree_built_from_the_same_folders() {
    for seed in 0..60u64 {
        let mut rng = Lcg(seed);
        let mut next = 0;
        let mut model = Folder::random(&mut rng, &mut next, "/r".into(), 0);
        let mut tree = Tree::from_records(model.records(), META);
        for step in 0..15 {
            let at = format!("seed {seed}, step {step}");
            let live: Vec<u32> = (1..tree.len() as u32)
                .filter(|&id| tree.get(id).is_some())
                .collect();
            let rev = tree.rev;
            if live.is_empty() || rng.below(6) == 0 {
                let old = tree.compact();
                assert_eq!(
                    (tree.rev, tree.dead),
                    (old.rev, 0),
                    "{at}: compaction keeps rev"
                );
            } else {
                let id = live[rng.below(live.len() as u32) as usize];
                let path: Vec<String> = tree.crumbs(id)[1..]
                    .iter()
                    .map(|&c| tree.name(c).to_owned())
                    .collect();
                if tree.node(id).is_dir() && rng.below(2) == 0 {
                    let fresh = Folder::random(&mut rng, &mut next, "ignored".into(), 2);
                    let target = model.at(&path);
                    let name = target.name.clone();
                    *target = Folder {
                        name,
                        ..fresh.clone()
                    };
                    tree.replace_subtree(id, fresh.records());
                } else {
                    model.remove(&path);
                    tree.remove(id);
                }
                assert_eq!(tree.rev, rev + 1, "{at}: a change is a new revision");
            }
            same_tree(&tree, &Tree::from_records(model.records(), META), &at);
        }
    }
}
