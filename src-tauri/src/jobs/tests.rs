use std::sync::Arc;

use super::*;

fn folder() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.bin"), vec![0u8; 5000]).unwrap();
    dir
}

fn job_for(path: &Path) -> ScanJob {
    ScanJob::new(
        dunce::canonicalize(path).unwrap().display().to_string(),
        None,
    )
}

/// Scans `root` and installs it as the worker does; returns its summary.
fn scan_now(state: &AppState, root: &Path, cache: &Path) -> Summary {
    let job = job_for(root);
    let tree = Arc::new(walk(&job).unwrap().expect("not cancelled"));
    let (generation, _) = state
        .install_scan(tree.clone(), &job.discard, true)
        .unwrap();
    save(&tree, cache).unwrap();
    state.summary(generation).unwrap()
}

#[test]
fn walk_reports_a_missing_root_and_a_cancel() {
    let dir = folder();
    let missing = ScanJob::new(dir.path().join("nope").display().to_string(), None);
    assert!(matches!(walk(&missing), Err(CmdError::Io { .. })));
    let cancelled = job_for(dir.path());
    cancelled.cancel.store(true, Ordering::Relaxed);
    assert_eq!(walk(&cancelled), Ok(None));
}

#[test]
fn a_scan_is_saved_and_listed() {
    let (root, cache) = (folder(), tempfile::tempdir().unwrap());
    let summary = scan_now(&AppState::default(), root.path(), cache.path());
    assert_eq!(summary.files, 1);
    assert!(
        summary.volume.is_none(),
        "a temp folder is not a volume root"
    );
    let scans = sources::cached_scans(cache.path());
    assert_eq!(scans.len(), 1);
    assert_eq!(scans[0].root, summary.root);
    assert!(!scans[0].outdated);
}

#[test]
fn unwritable_cache_is_not_saved() {
    let root = folder();
    let not_a_dir = tempfile::NamedTempFile::new().unwrap();
    let tree = walk(&job_for(root.path())).unwrap().unwrap();
    assert_eq!(save(&tree, not_a_dir.path()), Err(CmdError::CacheNotSaved));
}

#[test]
fn reopening_from_cache_replaces_the_root_with_a_new_generation() {
    let (root, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let summary = scan_now(&state, root.path(), cache.path());
    let reopened = open_cached(&state, cache.path(), &summary.root).unwrap();
    assert!(reopened.generation > summary.generation);
    assert_eq!(reopened.total, summary.total);
    assert_eq!(state.summary(reopened.generation), Ok(reopened));
    assert_eq!(
        state.summaries().len(),
        1,
        "reopening replaces the root in place"
    );
    assert_eq!(state.summary(summary.generation), Err(CmdError::StaleId));
}

#[test]
fn corrupt_cache_is_reported_not_fatal() {
    let (root, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let summary = scan_now(&state, root.path(), cache.path());
    fs::write(
        cache_path(cache.path(), Path::new(&summary.root)),
        b"garbage",
    )
    .unwrap();
    assert_eq!(
        open_cached(&state, cache.path(), &summary.root),
        Err(CmdError::CacheInvalid)
    );
}

#[test]
fn forgetting_an_open_root_deletes_its_scan_and_closes_it() {
    let (root, cache) = (folder(), tempfile::tempdir().unwrap());
    let state = AppState::default();
    let summary = scan_now(&state, root.path(), cache.path());
    forget(&state, cache.path(), &summary.root).unwrap();
    assert!(sources::cached_scans(cache.path()).is_empty());
    assert!(state.summaries().is_empty());
}

/// A cache file of format version 1: magic, version, header length, then a header that
/// starts with the root as a postcard string (one length byte for short roots).
fn write_outdated_cache(cache: &Path, root: &str) {
    let mut header = vec![root.len() as u8];
    header.extend_from_slice(root.as_bytes());
    let mut bytes = b"SZAT".to_vec();
    bytes.extend_from_slice(&1u32.to_le_bytes());
    bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&header);
    fs::write(cache_path(cache, Path::new(root)), bytes).unwrap();
}

#[test]
fn cache_from_an_older_version_is_listed_reported_and_forgettable() {
    let cache = tempfile::tempdir().unwrap();
    write_outdated_cache(cache.path(), "/old/scan");
    let scans = sources::cached_scans(cache.path());
    assert_eq!(scans.len(), 1);
    assert!(scans[0].outdated);
    assert_eq!(scans[0].root, "/old/scan");
    let state = AppState::default();
    assert_eq!(
        open_cached(&state, cache.path(), "/old/scan"),
        Err(CmdError::CacheOutdated)
    );
    forget(&state, cache.path(), "/old/scan").unwrap();
    assert!(sources::cached_scans(cache.path()).is_empty());
}

#[test]
fn volume_usage_is_known_only_for_mount_points() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(sources::volume_usage(dir.path()), None);
    if let Some(disk) = sources::list(dir.path()).disks.first() {
        let usage =
            sources::volume_usage(Path::new(&disk.mount)).expect("a listed disk is a mount point");
        assert!(usage.used <= usage.total);
    }
}
