//! Duplicates in temporary folders and trash requests of them, for the tests of the trash of
//! duplicates. A folder is named after its volume (`a-…` is on volume `a`); files go through
//! stand-ins of the trash (`recycle::fixture`), never the real one.

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime};

use sizeatlas_core::cleanup::{Context, Known, Os};
use tauri::async_runtime::block_on;
use tempfile::TempDir;

use super::tests::{dir_named, recorder, scanned};
use super::trash::{self, Confirmed};
use crate::cleanup::ContextFn;
use crate::dto::{DuplicatesDto, RefDto, TrashDto, TrashProgressDto};
use crate::error::CmdError;
use sizeatlas_core::duplicates::hash::BUFFER;

use crate::recycle::fixture::{HANG, Log, TrashOne, logged, settle};
use crate::state::AppState;

/// The length of a file unless a test says otherwise.
pub(super) const LEN: usize = 8192;

/// One time for every file, so a hard link made later has the time its path had.
pub(super) fn time() -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000)
}

/// Bytes of `len` that depend on `seed`: files of one seed are copies, of two seeds are not.
pub(super) fn bytes(seed: u8, len: usize) -> Vec<u8> {
    (0..len)
        .map(|i| (i.wrapping_mul(7) as u8).wrapping_add(seed))
        .collect()
}

/// Writes the files `files` (a path below `dir` and a seed) of `len` bytes, all with [`time`].
pub(super) fn write_len(dir: &Path, files: &[(&str, u8)], len: usize) {
    for &(name, seed) in files {
        let path = dir.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes(seed, len)).unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(time())
            .unwrap();
        settle(&path);
    }
}

pub(super) fn write(dir: &Path, files: &[(&str, u8)]) {
    write_len(dir, files, LEN);
}

pub(super) type Progress = Arc<Mutex<Vec<TrashProgressDto>>>;

/// A state whose roots are on the volume their folder is named after, the cache folder of its
/// saved scans and a log of the stand-in trash.
pub(super) struct Dups {
    pub state: AppState,
    pub cache: TempDir,
    pub log: Log,
    known: Arc<Mutex<Known>>,
}

impl Dups {
    pub fn new() -> Dups {
        let known = Arc::new(Mutex::new(Known::default()));
        let shared = known.clone();
        let context: ContextFn = Arc::new(move |_: &Path| Context {
            os: Os::current(),
            known: shared.lock().unwrap().clone(),
            running: Vec::new(),
            reboot_pending: false,
            recyclable: false,
        });
        let volume_of = Arc::new(|root: &Path| {
            let name = root.file_name().unwrap().to_string_lossy();
            name.split('-').next().unwrap().to_owned()
        });
        Dups {
            state: AppState::with_context_and_volumes(context, volume_of),
            cache: dir_named("cache"),
            log: Log::default(),
            known,
        }
    }

    /// A folder on `volume` with `files`, scanned and open; the folder and its root.
    pub fn root(&self, volume: &str, files: &[(&str, u8)]) -> (TempDir, String) {
        let dir = dir_named(&format!("{volume}-"));
        write(dir.path(), files);
        let root = self.open(dir.path());
        (dir, root)
    }

    /// Scans `path` and opens it; returns the root.
    pub fn open(&self, path: &Path) -> String {
        let tree = scanned(path);
        let root = tree.name(0).to_owned();
        self.state.install_tree(tree);
        root
    }

    /// `path` is a folder of installed programs (a zone), for searches that include zones.
    pub fn programs_at(&self, path: &Path) {
        let path = path.display().to_string();
        self.known.lock().unwrap().program_files.push(path);
    }

    /// A search with no query, run to its end; with the zones when `system`.
    pub fn find(&self, system: bool) {
        let (emit, _) = recorder();
        let (_, handle) = (self.state)
            .find_duplicates(String::new(), system, emit)
            .unwrap();
        handle.join().unwrap();
    }

    /// The refs of `paths`, each in the innermost open root that holds it, as the UI sends them.
    pub fn refs(&self, paths: &[PathBuf]) -> Vec<RefDto> {
        let roots = self.state.open_trees();
        paths
            .iter()
            .map(|path| {
                let (generation, tree) = (roots.iter())
                    .filter(|(_, t)| path.starts_with(t.name(0)))
                    .max_by_key(|(_, t)| t.name(0).len())
                    .expect("an open root holds it");
                RefDto {
                    root: tree.name(0).to_owned(),
                    generation: *generation,
                    id: tree.find_path(path).expect("scanned"),
                }
            })
            .collect()
    }

    pub fn confirm(&self, request: u64, paths: &[PathBuf]) -> Result<Confirmed, CmdError> {
        trash::confirm(&self.state, request, &self.refs(paths))
    }

    /// Runs `confirmed` on a thread of its own, its progress into `progress`.
    pub fn start_reporting(
        &self,
        confirmed: Confirmed,
        trash_one: TrashOne,
        report: impl Fn(TrashProgressDto) + Send + 'static,
    ) -> JoinHandle<Result<TrashDto, CmdError>> {
        let (state, cache) = (self.state.clone(), self.cache.path().to_owned());
        thread::spawn(move || {
            block_on(trash::run(
                &state,
                cache,
                confirmed,
                |_, _| true,
                trash_one,
                report,
            ))
        })
    }

    pub fn start(
        &self,
        confirmed: Confirmed,
        trash_one: TrashOne,
    ) -> JoinHandle<Result<TrashDto, CmdError>> {
        self.start_reporting(confirmed, trash_one, |_| ())
    }

    /// Confirms and runs the request `paths` through the logged stand-in.
    pub fn trash(&self, request: u64, paths: &[PathBuf]) -> Result<TrashDto, CmdError> {
        let confirmed = self.confirm(request, paths)?;
        self.start(confirmed, logged(&self.log)).join().unwrap()
    }

    pub fn dto(&self) -> DuplicatesDto {
        self.state.duplicates_since(0, 0)
    }

    /// The first path of each copy, by group.
    pub fn groups(&self) -> Vec<Vec<String>> {
        let copies = |g: &crate::dto::GroupDto| g.copies.iter().map(|c| c.path.clone()).collect();
        self.dto().groups.iter().map(copies).collect()
    }

    pub fn trashing(&self) -> u32 {
        self.state.0.duplicates.trashing.load(Ordering::SeqCst)
    }

    pub fn logged(&self) -> Vec<PathBuf> {
        self.log.lock().unwrap().clone()
    }
}

/// `path` (names split by `/`) below the root `root`, as the tree spells it.
pub(super) fn at(root: &str, path: &str) -> PathBuf {
    path.split('/')
        .fold(PathBuf::from(root), |at, name| at.join(name))
}

/// A recorder of the progress of a request.
pub(super) fn progress() -> (Progress, impl Fn(TrashProgressDto) + Send + 'static) {
    let log = Progress::default();
    let into = log.clone();
    (log, move |p| into.lock().unwrap().push(p))
}

/// Root `a` with a copy `x` and root `b` with the copy `x` that stays, longer than two reads of
/// the hash; the request for `a/x`, and the path of the copy that stays.
pub(super) fn two_big(t: &Dups) -> (Vec<TempDir>, String, PathBuf) {
    let len = 2 * BUFFER + 1;
    let (da, db) = (dir_named("a-"), dir_named("b-"));
    write_len(da.path(), &[("x", 1)], len);
    write_len(db.path(), &[("x", 1)], len);
    let (a, b) = (t.open(da.path()), t.open(db.path()));
    t.find(false);
    (vec![da, db], a, at(&b, "x"))
}

/// Runs the request for `a/x` with `on_keep` called when the progress names the copy that
/// stays, the hash about to start.
pub(super) fn with_keep(
    t: &Dups,
    a: &str,
    keep: &Path,
    on_keep: impl Fn() + Send + 'static,
) -> Result<TrashDto, CmdError> {
    let confirmed = t.confirm(1, &[at(a, "x")]).unwrap();
    let keep = keep.display().to_string();
    let report = move |p: TrashProgressDto| {
        let start = p.rehash.is_some_and(|[read, _]| read == 0);
        if start && p.current.as_deref() == Some(keep.as_str()) {
            on_keep();
        }
    };
    t.start_reporting(confirmed, logged(&t.log), report)
        .join()
        .unwrap()
}

/// Joins `running`, failing the test if it never ends.
pub(super) fn ended<T: Send + 'static>(running: JoinHandle<T>) -> T {
    let (sent, got) = mpsc::channel();
    thread::spawn(move || sent.send(running.join().unwrap()));
    got.recv_timeout(HANG).expect("it ends")
}

impl AppState {
    /// Makes the result look searched right now (or not), as a running job does.
    pub(super) fn set_running_for_test(&self, running: bool) {
        self.duplicates().running = running.then(|| (u64::MAX, Arc::new(AtomicBool::new(false))));
    }
}
