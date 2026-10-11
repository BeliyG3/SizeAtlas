use super::*;

#[test]
fn a_listed_folder_that_disappears_keeps_the_existing_access_error_handling() {
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
            LiveEvent::FolderDone { id, records } => {
                let t = tree.as_mut().unwrap();
                t.replace_subtree(id, records);
                t.assert_invariants();
                assert!(t.node(id).has(flags::ACCESS_ERROR));
                assert_eq!(t.access_errors, 1);
            }
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
            LiveEvent::FolderStarted { id, .. } => {
                let t = tree.as_mut().unwrap();
                assert_eq!(t.children(id).count(), 0);
                t.set_scanning(id, true);
                t.set_scan_progress(id, 100, 1);
            }
            LiveEvent::FolderDone { id, records } => {
                let t = tree.as_mut().unwrap();
                finished.push(t.name(id).to_owned());
                t.replace_subtree(id, records);
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
    fs::write(dir.path().join("hidden"), b"cloud").unwrap();
    let (tx, rx) = mpsc::channel();
    let cancel = AtomicBool::new(false);
    let progress = Progress::default();
    let meta = fs::metadata(dir.path()).unwrap();
    let ctx = Ctx {
        tx,
        next_id: AtomicU32::new(1),
        cancel: &cancel,
        progress: &progress,
        volume: Volume::of(dir.path(), &meta),
    };
    let task = DirTask {
        path: dir.path().into(),
        id: 0,
        parent: NO_PARENT,
        name: "cloud".into(),
        mtime: 0,
        flags: flags::IS_DIR | flags::CLOUD,
    };
    rayon::scope(|s| walk(s, &ctx, task));
    drop(ctx);
    let records: Vec<_> = rx.into_iter().collect();
    assert_eq!(records.len(), 1);
    assert!(records[0].files.is_empty());
    assert_eq!(progress.files.load(Ordering::Relaxed), 0);
}

#[test]
fn hardlinks_are_deduplicated_across_batches_and_keep_their_flags() {
    let mut seen = HashSet::new();
    for expected in [10, 0] {
        let mut batch = vec![DirRec {
            id: 0,
            parent: NO_PARENT,
            name: "root".into(),
            mtime: 0,
            flags: flags::IS_DIR,
            files: vec![FileRec {
                name: "link".into(),
                size: 10,
                len: 10,
                mtime: 0,
                flags: 0,
                ino: Some((1, 2)),
            }],
        }];
        deduplicate(&mut batch, &mut seen);
        let file = &batch[0].files[0];
        assert_eq!(file.size, expected);
        assert_eq!(file.ino, None);
        assert_ne!(file.flags & flags::HARDLINK, 0);
    }
}
