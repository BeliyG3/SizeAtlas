//! Helpers of the search tests: real files in a temporary folder, scanned, then searched.

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tempfile::TempDir;

use super::cache::HashCache;
use super::group::Group;
use super::hash::listed_mtime;
use super::{DiskKind, Event, Options, Outcome, Prepared, SearchRoot, prepare, search};
use crate::cleanup::{Known, Os};
use crate::scanner::{Progress, ScanOutcome, mtime_of, scan};
use crate::tree::{Query, Tree};

pub(super) const MIB: usize = 1 << 20;

/// A temporary folder outside `%TEMP%`, which lies in a protected zone on Windows.
pub(super) fn dir() -> TempDir {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/test-tmp");
    fs::create_dir_all(&base).unwrap();
    tempfile::Builder::new().tempdir_in(base).unwrap()
}

/// Bytes that differ along the file, so a hash of the wrong range does not match.
pub(super) fn data(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i * 7 + i / 4096) as u8).collect()
}

/// Writes `bytes` to `rel` below `dir` and waits until the listing shows its time.
pub(super) fn put(dir: &Path, rel: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    settle(&path);
    path
}

/// Writes `bytes` over the file at `path` and dates it an hour back, so its time surely changes.
pub(super) fn rewrite(path: &Path, bytes: &[u8]) {
    fs::write(path, bytes).unwrap();
    date(path, Duration::from_secs(3600));
}

/// Sets the time of the file at `path` to `ago` before now.
pub(super) fn date(path: &Path, ago: Duration) {
    let file = File::options().write(true).open(path).unwrap();
    file.set_modified(SystemTime::now() - ago).unwrap();
    drop(file);
    settle(path);
}

/// Waits until the listing of the folder of `path` shows the time `path` has. On Windows the
/// listing catches up a moment after a change; a scan takes the listed time.
pub(super) fn settle(path: &Path) {
    let start = Instant::now();
    let own = || fs::symlink_metadata(path).ok().map(|m| mtime_of(&m));
    while listed_mtime(path) != own() {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "the listing never caught up"
        );
        thread::sleep(Duration::from_millis(5));
    }
}

pub(super) fn scan_of(dir: &Path) -> Tree {
    match scan(dir, &AtomicBool::new(false), &Progress::default()).unwrap() {
        ScanOutcome::Done(tree) => tree,
        ScanOutcome::Cancelled => panic!("not cancelled"),
    }
}

pub(super) fn cache() -> Mutex<HashCache> {
    Mutex::new(HashCache::default())
}

/// What `prepare` takes out of `trees` (one root each, on one HDD) for `query`.
pub(super) fn prepared(trees: &[&Tree], query: &str) -> Prepared {
    let whole: Vec<(&Tree, u32)> = trees.iter().map(|&t| (t, 0)).collect();
    prepared_from(&whole, query)
}

/// [`prepared`] with each tree walked from the node paired with it.
pub(super) fn prepared_from(trees: &[(&Tree, u32)], query: &str) -> Prepared {
    let known = Known::default();
    let query = Query::parse(query);
    let roots: Vec<SearchRoot> = trees
        .iter()
        .map(|&(tree, start)| SearchRoot {
            tree,
            generation: 0,
            volume: "v",
            disk: DiskKind::Hdd,
            start,
        })
        .collect();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let opts = Options {
        query: query.as_ref(),
        include_zones: false,
        os: Os::current(),
        known: &known,
        now_ns: now.as_nanos() as i64,
    };
    prepare(&roots, &opts)
}

/// `prepare`, then `search`.
pub(super) fn run(
    trees: &[&Tree],
    query: &str,
    cache: &Mutex<HashCache>,
) -> (Vec<Group>, Outcome, Vec<Event>) {
    finish(
        prepared(trees, query),
        cache,
        &AtomicBool::new(false),
        false,
    )
}

/// Searches `prepared`; with `cancel_on_group` the first group sets `cancel`.
pub(super) fn finish(
    prepared: Prepared,
    cache: &Mutex<HashCache>,
    cancel: &AtomicBool,
    cancel_on_group: bool,
) -> (Vec<Group>, Outcome, Vec<Event>) {
    let events = Mutex::new(Vec::new());
    let emit = |e: Event| {
        if cancel_on_group && matches!(e, Event::Group(_)) {
            cancel.store(true, Ordering::Relaxed);
        }
        events.lock().unwrap().push(e);
    };
    let outcome = search(prepared, cache, cancel, &emit);
    let events = events.into_inner().unwrap();
    let groups = events
        .iter()
        .filter_map(|e| match e {
            Event::Group(g) => Some(g.clone()),
            Event::Progress(_) => None,
        })
        .collect();
    (groups, outcome, events)
}

/// The file names of the first path of each object of `group`.
pub(super) fn names(group: &Group) -> Vec<String> {
    let name = |p: &Path| p.file_name().unwrap().to_string_lossy().into_owned();
    group
        .objects
        .iter()
        .map(|o| name(&o.paths[0].path))
        .collect()
}

/// Every file name of every group, sorted, for comparing two runs.
pub(super) fn all_names(groups: &[Group]) -> Vec<Vec<String>> {
    let mut all: Vec<_> = groups.iter().map(names).collect();
    all.sort();
    all
}
