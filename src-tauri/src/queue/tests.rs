use super::*;

#[test]
fn full_scans_cover_descendant_paths_but_not_sibling_prefixes() {
    let mut queue = ScanQueue::default();
    queue.push("/data".into()).unwrap();
    assert!(queue.full_scan_contains("/data/sub", false));
    assert!(!queue.full_scan_contains("/database/sub", true));
    assert!(!queue.full_scan_contains("/data", false));
    assert!(queue.full_scan_contains("/data", true));
}

fn states(queue: &ScanQueue) -> Vec<(String, QueueState)> {
    queue
        .entries()
        .into_iter()
        .map(|e| (e.root, e.state))
        .collect()
}

fn entry(root: &str, state: QueueState) -> (String, QueueState) {
    (root.to_owned(), state)
}

#[test]
fn a_root_waits_while_another_scans_and_is_never_queued_twice() {
    let mut queue = ScanQueue::default();
    let a = queue
        .push("a".into())
        .expect("an idle queue starts at once");
    assert_eq!(a.root, "a");
    assert!(queue.push("b".into()).is_none());
    assert!(queue.push("a".into()).is_none(), "already scanning");
    assert!(queue.push("b".into()).is_none(), "already waiting");
    assert_eq!(
        states(&queue),
        [
            entry("a", QueueState::Scanning),
            entry("b", QueueState::Queued)
        ]
    );
    assert_eq!(queue.advance().map(|j| j.root), Some("b".to_owned()));
    assert!(queue.advance().is_none());
    assert!(queue.entries().is_empty());
}

#[test]
fn cancel_stops_the_running_scan_or_drops_a_waiting_one() {
    let mut queue = ScanQueue::default();
    let a = queue.push("a".into()).unwrap();
    queue.push("b".into());
    queue.push("c".into());
    assert!(queue.cancel(Some("b")), "a waiting root is dropped");
    assert!(!a.cancelled());
    assert!(!queue.cancel(None), "nothing waiting was dropped");
    assert!(a.cancelled(), "no root: the running scan");
    assert!(!queue.cancel(Some("zzz")));
    assert_eq!(
        states(&queue),
        [
            entry("a", QueueState::Scanning),
            entry("c", QueueState::Queued)
        ]
    );
}

#[test]
fn a_cancelled_root_can_be_queued_again() {
    let mut queue = ScanQueue::default();
    let first = queue.push("a".into()).unwrap();
    queue.cancel(Some("a"));
    assert!(
        queue.push("a".into()).is_none(),
        "it waits for the cancelled scan to end"
    );
    assert_eq!(
        states(&queue),
        [
            entry("a", QueueState::Scanning),
            entry("a", QueueState::Queued)
        ]
    );
    let again = queue.advance().unwrap();
    assert!(first.cancelled() && !again.cancelled());
}

#[test]
fn stopping_all_cancels_the_scan_and_empties_the_queue() {
    let mut queue = ScanQueue::default();
    let a = queue.push("a".into()).unwrap();
    queue.push("b".into());
    queue.stop_all();
    assert!(a.cancelled());
    assert!(
        !a.discard.load(Ordering::Relaxed),
        "a walk that has finished is still installed"
    );
    assert_eq!(states(&queue), [entry("a", QueueState::Scanning)]);
    assert!(queue.advance().is_none());
}

#[test]
fn a_cancel_also_discards_a_finished_walk() {
    let mut queue = ScanQueue::default();
    let a = queue.push("a".into()).unwrap();
    queue.cancel(Some("a"));
    assert!(a.discard.load(Ordering::Relaxed));
}

fn target(id: u32) -> FolderTarget {
    FolderTarget {
        scan: 1,
        generation: 1,
        id,
        path: PathBuf::from(format!("/a/f{id}")),
    }
}

/// Root and folder of every entry, the running one first.
fn jobs(queue: &ScanQueue) -> Vec<(String, Option<String>)> {
    queue
        .entries()
        .into_iter()
        .map(|e| (e.root, e.folder))
        .collect()
}

fn job(root: &str, folder: Option<u32>) -> (String, Option<String>) {
    let path = folder.map(|id| target(id).path.display().to_string());
    (root.to_owned(), path)
}

#[test]
fn a_full_scan_takes_the_place_of_the_waiting_folders_of_its_root() {
    let mut queue = ScanQueue::default();
    queue
        .push("b".into())
        .expect("an idle queue starts at once");
    assert!(queue.push_folder("a".into(), target(1)).is_none());
    assert!(
        queue.push_folder("a".into(), target(1)).is_none(),
        "waiting already"
    );
    queue.push_folder("a".into(), target(2));
    queue.push_folder("c".into(), target(3));
    assert_eq!(
        jobs(&queue),
        [
            job("b", None),
            job("a", Some(1)),
            job("a", Some(2)),
            job("c", Some(3))
        ]
    );
    queue.push("a".into());
    assert_eq!(
        jobs(&queue),
        [job("b", None), job("c", Some(3)), job("a", None)]
    );
    assert!(queue.push_folder("a".into(), target(4)).is_none());
    assert_eq!(
        jobs(&queue).len(),
        3,
        "the waiting full scan covers the folder"
    );
}

#[test]
fn a_folder_is_not_queued_under_a_running_scan_of_its_root_and_stops_with_it() {
    let mut queue = ScanQueue::default();
    let a = queue.push("a".into()).unwrap();
    assert!(queue.push_folder("a".into(), target(1)).is_none());
    assert_eq!(jobs(&queue), [job("a", None)], "the running scan covers it");
    queue.cancel(Some("a"));
    assert!(a.cancelled());
    queue.push_folder("a".into(), target(1));
    let refresh = queue
        .advance()
        .expect("the refresh waited for the cancelled scan");
    assert_eq!(refresh.folder, Some(target(1)));
    assert!(
        queue.push_folder("a".into(), target(1)).is_none(),
        "refreshing already"
    );
    queue.push_folder("a".into(), target(2));
    assert_eq!(jobs(&queue), [job("a", Some(1)), job("a", Some(2))]);
    assert!(queue.cancel(Some("a")), "the waiting refresh is dropped");
    assert!(refresh.cancelled());
    assert!(queue.advance().is_none());
}

fn gone(path: &str) -> TrashedPath {
    TrashedPath {
        path: PathBuf::from(path),
        parent_before: [Some(1), None],
        parent_after: Some(2),
    }
}

#[test]
fn a_refresh_refuses_the_trash_only_inside_its_folder_and_above_it() {
    let mut queue = ScanQueue::default();
    let job = queue.push_folder("/a".into(), target(1)).unwrap();
    let refused = |path: &str| job.refuses_trash(Path::new(path), "/a");
    assert!(refused("/a/f1"));
    assert!(refused("/a/f1/x.bin"));
    assert!(refused("/a"), "an ancestor takes the folder with it");
    assert!(!refused("/a/f10"), "a sibling with the same prefix");
    assert!(!refused("/a/top.bin"));
    assert!(!refused("/b/f1"));
}

#[test]
fn a_rescan_refuses_its_root_and_above_and_notes_what_goes_inside() {
    let mut queue = ScanQueue::default();
    let job = queue.push("/a/b".into()).unwrap();
    let refused = |path: &str, tree: &str| job.refuses_trash(Path::new(path), tree);
    assert!(refused("/a/b", "/a"));
    assert!(refused("/a", "/"));
    assert!(!refused("/a/b/x", "/a/b"));
    assert!(!refused("/a/b/x", "/a"), "a rescan is told what went");
    assert!(!refused("/a/c", "/a"));
    queue.note_trashed(vec![gone("/a/b/x"), gone("/a/c")]);
    assert_eq!(*job.trashed.lock().unwrap(), [gone("/a/b/x")]);
}

#[test]
fn a_first_scan_refuses_what_it_holds_in_other_open_trees() {
    let mut queue = ScanQueue::default();
    let job = queue.push("/d".into()).unwrap();
    job.first_scan.store(true, Ordering::Relaxed);
    let refused = |path: &str, tree: &str| job.refuses_trash(Path::new(path), tree);
    assert!(refused("/d/data/x", "/d/data"), "an open root inside it");
    assert!(
        !refused("/d/data/x", "/d"),
        "its own tree decides by its flags"
    );
    assert!(!refused("/e/x", "/e"));
}

#[test]
fn a_cancelled_job_refuses_nothing_and_notes_nothing() {
    let mut queue = ScanQueue::default();
    let job = queue.push("/a".into()).unwrap();
    queue.cancel(Some("/a"));
    assert!(queue.running_job().is_none());
    assert!(!job.refuses_trash(Path::new("/a"), "/"));
    queue.note_trashed(vec![gone("/a/x")]);
    assert!(job.trashed.lock().unwrap().is_empty());
}
