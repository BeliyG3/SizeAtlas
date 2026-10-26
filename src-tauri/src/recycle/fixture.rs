//! A scanned folder, stand-ins for the trash and confirmed trash requests, shared by the tests
//! of `recycle`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};
use sizeatlas_core::tree::ListOrder;
use tauri::async_runtime::block_on;
use tempfile::TempDir;
use tokio::sync::OwnedMutexGuard;

use super::disk::{listed_mtime, modified};
use super::requests::{Ticket, Work, leave, run_request};
use super::run_plan;
use crate::dto::TrashDto;
use crate::error::CmdError;
use crate::state::{AppState, TrashItem, TrashPlan};
use crate::writes::{Turn, WriteGuard};

/// root/top.bin and root/sub/{x.bin, y.bin}, scanned and open; returns the folder and the
/// generation of its tree.
pub fn open(state: &AppState) -> (TempDir, u64) {
    open_in(state, tempfile::tempdir().unwrap())
}

/// [`open`] in a folder whose name starts with `volume` and a dash, for a state that tells the
/// volume of a root by that name.
pub fn open_on(state: &AppState, volume: &str) -> (TempDir, u64) {
    let prefix = format!("{volume}-");
    open_in(
        state,
        tempfile::Builder::new().prefix(&prefix).tempdir().unwrap(),
    )
}

fn open_in(state: &AppState, dir: TempDir) -> (TempDir, u64) {
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    fs::write(sub.join("x.bin"), vec![0u8; 1000]).unwrap();
    fs::write(sub.join("y.bin"), vec![0u8; 2000]).unwrap();
    fs::write(dir.path().join("top.bin"), vec![0u8; 3000]).unwrap();
    for item in [
        sub.join("x.bin"),
        sub.join("y.bin"),
        sub,
        dir.path().join("top.bin"),
    ] {
        settle(&item);
    }
    let ScanOutcome::Done(tree) =
        scan(dir.path(), &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    let generation = state.install_tree(tree);
    (dir, generation)
}

/// Waits until the listing of the folder of `path` shows the time `path` has. On Windows the
/// listing catches up a moment after a change; a scan takes the listed time.
pub fn settle(path: &Path) {
    let start = Instant::now();
    while listed_mtime(path) != modified(path) {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "the listing never caught up"
        );
        thread::sleep(Duration::from_millis(5));
    }
}

/// Id of the item at `path` below the root.
pub fn id(state: &AppState, generation: u64, path: &[&str]) -> u32 {
    path.iter().fold(0, |at, name| {
        state
            .children(generation, at, 0, 100, ListOrder::DEFAULT)
            .unwrap()
            .items
            .into_iter()
            .find(|i| i.name == *name)
            .expect("item exists")
            .id
    })
}

pub fn rev(state: &AppState, generation: u64) -> u64 {
    state.summary(generation).unwrap().rev
}

/// Path of `names` below the root, as the tree spells it.
pub fn real(dir: &TempDir, names: &[&str]) -> PathBuf {
    let canonical = dunce::canonicalize(dir.path()).unwrap();
    names.iter().fold(canonical, |path, name| path.join(name))
}

/// The locks a trash request of `root` holds while it runs: the turn of its volume, then the
/// root's write.
pub fn hold_like_a_trash(state: &AppState, root: &str) -> (OwnedMutexGuard<()>, WriteGuard) {
    let turn = tauri::async_runtime::block_on(state.volume_turn(&state.volume_of(root)));
    let write = tauri::async_runtime::block_on(state.begin_write(root)).unwrap();
    (turn, write)
}

/// Every item may go (the system's trash check is `bin_takes` with `sizeatlas_core::can_recycle`).
pub fn anywhere(_: &TrashItem) -> Result<(), CmdError> {
    Ok(())
}

/// A stand-in for the OS trash: deletes for good and records what it got.
pub fn deleting(log: &Mutex<Vec<PathBuf>>) -> impl Fn(&Path) -> Result<(), String> + '_ {
    move |path| {
        log.lock().unwrap().push(path.to_owned());
        let removed = if path.is_dir() {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        };
        removed.map_err(|e| e.to_string())
    }
}

/// A directory link at `link` to `target`: a junction on Windows, a symlink on Unix. `false`
/// when the system does not allow it here.
pub fn link(target: &Path, link: &Path) -> bool {
    #[cfg(windows)]
    return std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .is_ok_and(|out| out.status.success());
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, link).is_ok();
}

/// Only a safety net against a hang: every wait it guards ends at once when the code works.
pub const HANG: Duration = Duration::from_secs(10);

pub type Log = Arc<Mutex<Vec<PathBuf>>>;
pub type TrashOne = Box<dyn Fn(&Path) -> Result<(), String> + Send>;
pub type Running = JoinHandle<Result<TrashDto, CmdError>>;

/// A state whose roots are on the volume their folder is named after (`v1-...`).
pub fn on_volumes() -> AppState {
    AppState::with_volumes(Arc::new(|root| {
        let name = root.file_name().unwrap().to_string_lossy();
        name.split('-').next().unwrap().to_owned()
    }))
}

/// [`deleting`] that records into `log`, for a request on a thread of its own.
pub fn logged(log: &Log) -> TrashOne {
    let log = log.clone();
    Box::new(move |path| deleting(&log)(path))
}

pub fn root_of(state: &AppState, generation: u64) -> String {
    state.tree(generation).unwrap().name(0).to_owned()
}

/// Stand-ins for the trash that say which item they got and let it go only when the sender
/// [`gate`] returns sends (one item per send) or is dropped (every item from then on).
pub struct Gate {
    pub entered: Receiver<PathBuf>,
    enter: Sender<PathBuf>,
    pass: Arc<Mutex<Receiver<()>>>,
    log: Log,
}

pub fn gate() -> (Gate, Sender<()>) {
    let (enter, entered) = mpsc::channel();
    let (go, pass) = mpsc::channel();
    let pass = Arc::new(Mutex::new(pass));
    let log = Log::default();
    let gate = Gate {
        entered,
        enter,
        pass,
        log,
    };
    (gate, go)
}

impl Gate {
    pub fn trash_one(&self) -> TrashOne {
        let (enter, pass, log) = (self.enter.clone(), self.pass.clone(), self.log.clone());
        Box::new(move |path| {
            enter.send(path.to_owned()).unwrap();
            let _ = pass.lock().unwrap().recv();
            deleting(&log)(path)
        })
    }

    /// The item that came to the gate next.
    pub fn next(&self) -> PathBuf {
        self.entered.recv_timeout(HANG).expect("an item comes")
    }

    pub fn log(&self) -> Vec<PathBuf> {
        self.log.lock().unwrap().clone()
    }
}

/// A request as the command `trash` confirms it: registered, queued on its volume, planned.
pub struct Confirmed {
    ticket: Ticket,
    turn: Turn,
    generation: u64,
    plan: TrashPlan,
}

pub fn confirm(state: &AppState, request: u64, generation: u64, items: &[&[&str]]) -> Confirmed {
    let ids: Vec<u32> = items
        .iter()
        .map(|path| id(state, generation, path))
        .collect();
    let root = root_of(state, generation);
    let volume = state.volume_of(&root);
    let ticket = state.enqueue_trash(request, &root, &volume).unwrap();
    let turn = Turn::reserve(state.volume_turn(&volume));
    let plan = state.trash_plan(generation, rev(state, generation), &ids);
    Confirmed {
        ticket,
        turn,
        generation,
        plan: plan.unwrap(),
    }
}

/// Runs `request` on a thread of its own, its items through `trash_one`.
pub fn start(state: &AppState, cache: &Path, request: Confirmed, trash_one: TrashOne) -> Running {
    let (state, cache) = (state.clone(), cache.to_owned());
    let Confirmed {
        ticket,
        turn,
        generation,
        plan,
    } = request;
    let work: Work = Box::new(move |state, dir, stop| {
        run_plan(
            state,
            dir,
            generation,
            plan,
            anywhere,
            trash_one,
            stop,
            |_| (),
        )
    });
    thread::spawn(move || block_on(run_request(state, cache, ticket, turn, work)))
}

/// `request` with its plan refused after all, as the command `trash` lets it go.
pub fn refuse(state: &AppState, cache: &Path, request: Confirmed) {
    let (state, cache) = (state.clone(), cache.to_owned());
    block_on(leave(state, cache, request.ticket, request.turn));
}

pub fn done(running: Running) -> TrashDto {
    running.join().unwrap().unwrap()
}
