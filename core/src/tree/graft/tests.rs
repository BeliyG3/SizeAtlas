use crate::tree::{DirRec, FileRec, NO_PARENT, ScanMeta, SizeMode, Tree, flags, sample_tree};

#[test]
fn graft_preserves_ids_structure_totals_and_access_errors() {
    let mut tree = sample_tree();
    let docs = tree
        .children(0)
        .find(|&id| tree.name(id) == "docs")
        .unwrap();
    let stable = tree
        .children(0)
        .map(|id| (id, tree.path(id)))
        .collect::<Vec<_>>();
    let meta = ScanMeta {
        cluster: 1,
        size_mode: SizeMode::Logical,
        scanned_at: 0,
    };
    let sub = Tree::from_records(
        vec![
            DirRec {
                id: 0,
                parent: NO_PARENT,
                name: "ignored".into(),
                mtime: 9,
                flags: flags::ACCESS_ERROR,
                files: vec![],
            },
            DirRec {
                id: 1,
                parent: 0,
                name: "new".into(),
                mtime: 7,
                flags: flags::ACCESS_ERROR,
                files: vec![FileRec {
                    name: "file".into(),
                    size: 11,
                    len: 13,
                    mtime: 3,
                    flags: 0,
                    ino: None,
                }],
            },
        ],
        meta,
    );
    let buffer = tree.graft_buffer(sub.len() - 1);
    tree.reserve_graft(buffer);
    tree.graft(docs, sub);
    tree.assert_invariants();
    assert_eq!(
        (
            tree.node(0).size,
            tree.node(0).files,
            tree.node(0).len,
            tree.node(0).dirs
        ),
        (511, 2, 513, 2)
    );
    assert_eq!(tree.access_errors, 2);
    assert_eq!(tree.node(docs).mtime, 9);
    for (id, path) in stable {
        assert_eq!(tree.path(id), path);
    }
    // Replacing an unreadable subtree removes both old access errors.
    let empty = Tree::from_records(
        vec![DirRec {
            id: 0,
            parent: NO_PARENT,
            name: "unused".into(),
            mtime: 0,
            flags: 0,
            files: vec![],
        }],
        meta,
    );
    tree.graft(docs, empty);
    tree.assert_invariants();
    assert_eq!(tree.access_errors, 0);
    assert_eq!(
        (
            tree.node(0).size,
            tree.node(0).files,
            tree.node(0).len,
            tree.node(0).dirs
        ),
        (500, 1, 500, 1)
    );
}
