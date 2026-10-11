use super::*;

#[test]
fn a_listed_folder_that_disappears_is_removed_without_an_access_error() {
    let dir = tempfile::tempdir().unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    let mut tree = None;
    scan_live(
        dir.path(),
        &AtomicBool::new(false),
        &Progress::default(),
        |event| match event {
            LiveEvent::Started(t) => tree = Some(t),
            LiveEvent::FolderStarted { .. } => fs::remove_dir(&sub).unwrap(),
            LiveEvent::FolderGone { id } => {
                let t = tree.as_mut().unwrap();
                t.remove(id);
                t.assert_invariants();
                assert!(!t.node(id).is_alive());
                assert_eq!(t.access_errors, 0);
                assert_eq!(t.node(0).dirs, 0);
            }
            LiveEvent::FolderDone { .. } => panic!("gone folder was published"),
        },
    )
    .unwrap();
}

#[test]
fn folders_finish_in_name_order_with_stable_ids_and_correct_ancestor_totals() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("top.txt"), b"top").unwrap();
    for name in ["z", "a", "m"] {
        fs::create_dir_all(dir.path().join(name).join("deep")).unwrap();
        fs::write(dir.path().join(name).join("deep/f.txt"), b"hello").unwrap();
    }
    let mut tree = None;
    let mut stable = Vec::new();
    let mut finished = Vec::new();
    let mut published: Vec<(u32, PathBuf)> = Vec::new();
    let result = scan_live(
        dir.path(),
        &AtomicBool::new(false),
        &Progress::default(),
        |event| match event {
            LiveEvent::Started(t) => {
                assert!(
                    t.list(0, crate::tree::ListKind::EmptyFolders, 100)
                        .items
                        .is_empty(),
                    "pending folders are not known to be empty"
                );
                assert_eq!(t.node(0).files, 1, "root files are available immediately");
                stable = t
                    .children(0)
                    .map(|id| (id, t.name(id).to_owned()))
                    .collect();
                assert!(
                    t.children(0)
                        .filter(|&id| t.node(id).is_dir())
                        .all(|id| t.node(id).has(flags::PENDING))
                );
                tree = Some(t);
            }
            LiveEvent::FolderGone { .. } => panic!("folder unexpectedly disappeared"),
            LiveEvent::FolderStarted { id, .. } => {
                let t = tree.as_mut().unwrap();
                assert_eq!(t.children(id).count(), 0);
                t.set_scanning(id, true);
                t.set_scan_progress(id, 100, 1);
            }
            LiveEvent::FolderDone { id, tree: sub } => {
                let t = tree.as_mut().unwrap();
                finished.push(t.name(id).to_owned());
                t.graft(id, sub);
                t.assert_invariants();
                assert_eq!(t.node(0).files as usize, finished.len() + 1);
                assert!(!t.node(id).has(flags::PENDING | flags::SCANNING));
                for (id, name) in &stable {
                    assert_eq!(t.name(*id), name);
                }
                for (id, path) in &published {
                    assert_eq!(t.path(*id), *path, "finished descendants keep their ids");
                    assert!(t.node(*id).is_alive());
                }
                published = (0..t.len() as u32).map(|id| (id, t.path(id))).collect();
                assert_eq!(t.node(id).dirs, 1);
                assert_eq!(t.node(id).len, 5);
            }
        },
    )
    .unwrap();
    assert_eq!(result, LiveOutcome::Done);
    assert_eq!(finished, ["a", "m", "z"]);
}

#[test]
fn cancellation_at_a_folder_boundary_never_publishes_the_next_batch() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["a", "b"] {
        fs::create_dir(dir.path().join(name)).unwrap();
    }
    let cancel = AtomicBool::new(false);
    let mut done = 0;
    let result = scan_live(dir.path(), &cancel, &Progress::default(), |event| {
        if let LiveEvent::FolderDone { .. } = event {
            done += 1;
            cancel.store(true, Ordering::Relaxed);
        }
    })
    .unwrap();
    assert_eq!(result, LiveOutcome::Cancelled);
    assert_eq!(done, 1);
}

#[test]
fn cancellation_inside_a_folder_drops_its_contents() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("a")).unwrap();
    let cancel = AtomicBool::new(false);
    let result = scan_live(
        dir.path(),
        &cancel,
        &Progress::default(),
        |event| match event {
            LiveEvent::FolderStarted { .. } => cancel.store(true, Ordering::Relaxed),
            LiveEvent::FolderDone { .. } => panic!("cancelled contents were published"),
            _ => {}
        },
    )
    .unwrap();
    assert_eq!(result, LiveOutcome::Cancelled);
}

#[test]
fn cloud_only_directory_is_listed_without_walking_it() {
    let dir = tempfile::tempdir().unwrap();
    let cloud = dunce::canonicalize(dir.path()).unwrap().join("cloud");
    fs::create_dir(&cloud).unwrap();
    fs::write(cloud.join("hidden"), b"cloud").unwrap();
    listing::CLOUD_FOLDER.with(|folder| *folder.borrow_mut() = Some(cloud));
    let progress = Progress::default();
    let mut published = 0;
    scan_live(
        dir.path(),
        &AtomicBool::new(false),
        &progress,
        |event| match event {
            LiveEvent::Started(tree) => {
                let id = tree.children(0).next().unwrap();
                assert!(tree.node(id).has(flags::CLOUD | flags::PENDING));
                assert_eq!(tree.node(0).dirs, 1);
            }
            LiveEvent::FolderDone { tree, .. } => {
                published += 1;
                assert!(tree.node(0).has(flags::CLOUD));
                assert_eq!(tree.len(), 1);
                assert_eq!(
                    (tree.node(0).files, tree.node(0).len, tree.node(0).dirs),
                    (0, 0, 0)
                );
            }
            _ => {}
        },
    )
    .unwrap();
    listing::CLOUD_FOLDER.with(|folder| *folder.borrow_mut() = None);
    assert_eq!(published, 1);
    assert_eq!(progress.files.load(Ordering::Relaxed), 0);
}

#[test]
fn hardlinks_choose_name_sorted_bfs_order_across_shuffled_records_and_batches() {
    let meta = ScanMeta {
        cluster: 1,
        size_mode: crate::tree::SizeMode::Allocated,
        scanned_at: 0,
    };
    let file = |name: &str| FileRec {
        name: name.into(),
        size: 10,
        len: 10,
        mtime: 0,
        flags: 0,
        ino: Some((1, 2)),
    };
    let record = |id, parent, name: &str, files| DirRec {
        id,
        parent,
        name: name.into(),
        mtime: 0,
        flags: flags::IS_DIR,
        files,
    };
    for reverse in [false, true] {
        let mut seen = HashSet::new();
        let mut records = vec![
            record(2, 0, "z", vec![file("link")]),
            record(0, NO_PARENT, "root", vec![]),
            record(1, 0, "a", vec![file("z"), file("a")]),
        ];
        if reverse {
            records.reverse();
        }
        let tree = Tree::from_records_with_links(records, meta, &mut seen);
        tree.assert_invariants();
        let a = tree.find_path(&PathBuf::from("root/a/a")).unwrap();
        assert_eq!(tree.node(a).size, 10);
        assert!(tree.node(a).has(flags::HARDLINK));
        assert_eq!(tree.node(0).size, 10);
        let second = Tree::from_records_with_links(
            vec![record(0, NO_PARENT, "later", vec![file("link")])],
            meta,
            &mut seen,
        );
        assert_eq!(second.node(0).size, 0);
        assert_eq!(second.node(0).len, 10);
    }
}
