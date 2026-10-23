//! The clean-up modes on a scanned temporary folder laid out like a Windows drive, seen through
//! an injected context. Never the real one: the temporary folder lies in this machine's `%TEMP%`.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use sizeatlas_core::cleanup::{Cleanup, Context, Info, Known, Mode, Os, Reason, Running};
use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};
use sizeatlas_core::tree::{ListKind, Tree};

use super::cleanup_rows;
use crate::dto::{FoundDto, InfoDto, InfoKind, ListDto};
use crate::state::AppState;

const DAY: i64 = 86_400;
const HOME: &str = "Users/u";
const LOCAL: &str = "Users/u/AppData/Local";
const TEMP: &str = "Users/u/AppData/Local/Temp";
const CHROME: &str = "Users/u/AppData/Local/Google/Chrome/User Data/Default";

/// The known folders, all inside the scanned folder `root`.
fn known(root: &Path) -> Known {
    let at = |rel: &str| root.join(rel).to_string_lossy().into_owned();
    Known {
        home: at(HOME),
        local: at(LOCAL),
        local_low: at("Users/u/AppData/LocalLow"),
        roaming: at("Users/u/AppData/Roaming"),
        temp: at(TEMP),
        system_root: at("Windows"),
        program_data: at("ProgramData"),
        system_drive: at(""),
        program_files: vec![at("Program Files")],
        users: Some(at("Users")),
        ..Known::default()
    }
}

/// A scanned "drive" with rows of both modes, an installed program and a pagefile, scanned a
/// month ago as far as the ages go.
struct Machine {
    _dir: tempfile::TempDir,
    state: AppState,
    generation: u64,
    tree: Arc<Tree>,
    /// Executables the injected context reports as running.
    running: Arc<Mutex<Vec<&'static str>>>,
    /// How often the context was built.
    calls: Arc<AtomicUsize>,
}

fn put(root: &Path, rel: &str, len: usize) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, vec![1u8; len]).unwrap();
}

fn machine() -> Machine {
    let dir = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    put(&root, &format!("{TEMP}/old/a.bin"), 32_768);
    put(&root, &format!("{TEMP}/work/scene.blend"), 24_576);
    put(&root, &format!("{CHROME}/Preferences"), 10);
    put(&root, &format!("{CHROME}/Cache/data_1"), 65_536);
    put(&root, &format!("{LOCAL}/npm-cache/_cacache/index"), 16_384);
    put(&root, "Users/u/proj/package.json", 10);
    put(&root, "Users/u/proj/package-lock.json", 10);
    put(&root, "Users/u/proj/node_modules/pkg/index.js", 49_152);
    put(&root, "Users/u/tool/.venv/pyvenv.cfg", 8_192);
    put(&root, "Program Files/App/package.json", 10);
    put(&root, "Program Files/App/node_modules/x.js", 40_960);
    put(&root, "pagefile.sys", 4_096);
    let ScanOutcome::Done(mut tree) =
        scan(&root, &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    tree.scanned_at += 30 * DAY;
    let running: Arc<Mutex<Vec<&'static str>>> = Arc::default();
    let calls = Arc::new(AtomicUsize::new(0));
    let (exes, count) = (running.clone(), calls.clone());
    let state = AppState::with_context(Arc::new(move |root: &Path| {
        count.fetch_add(1, Ordering::Relaxed);
        Context {
            // The Windows tables on every host: their paths split on both separators.
            os: Os::Windows,
            known: known(root),
            running: exes
                .lock()
                .unwrap()
                .iter()
                .map(|&exe| Running {
                    exe: exe.into(),
                    cmd: String::new(),
                })
                .collect(),
            reboot_pending: false,
            recyclable: true,
        }
    }));
    let generation = state.install_tree(tree);
    let tree = state.tree(generation).unwrap();
    Machine {
        _dir: dir,
        state,
        generation,
        tree,
        running,
        calls,
    }
}

impl Machine {
    fn id(&self, rel: &str) -> u32 {
        rel.split('/').fold(0, |at, name| {
            self.tree
                .children(at)
                .find(|&c| self.tree.name(c) == name)
                .unwrap_or_else(|| panic!("no {name} in {rel}"))
        })
    }

    fn size(&self, rel: &str) -> u64 {
        self.tree.node(self.id(rel)).size
    }

    fn list(&self, base: &str, kind: ListKind, limit: u32) -> ListDto {
        let base = if base.is_empty() { 0 } else { self.id(base) };
        self.state
            .list(self.generation, base, kind, limit, None)
            .unwrap()
    }
}

fn names(list: &ListDto) -> Vec<&str> {
    list.items.iter().map(|i| i.item.name.as_str()).collect()
}

fn reasons(list: &ListDto) -> Vec<(Reason, Option<&str>, Option<bool>)> {
    list.items
        .iter()
        .map(|i| {
            let r = i.reason.as_ref().expect("a clean-up row has a reason");
            (r.reason, r.command.as_deref(), r.restorable)
        })
        .collect()
}

fn found(list: &ListDto) -> (u64, u64) {
    let found = list.found.expect("a clean-up list has totals");
    (found.count, found.size)
}

fn info(list: &ListDto) -> &[InfoDto] {
    &list
        .cleanup
        .as_ref()
        .expect("a clean-up list has info")
        .info
}

#[test]
fn both_modes_list_their_rows_with_reasons_totals_and_info() {
    let m = machine();
    let list = m.list("", ListKind::Cleanup, 10);
    assert_eq!(names(&list), ["Cache", "old", "_cacache"]);
    assert_eq!(
        reasons(&list),
        [
            (Reason::BrowserCache, None, None),
            (Reason::TempOld, None, None),
            (Reason::PackageCache, Some("npm cache clean --force"), None),
        ]
    );
    let sizes = [
        &format!("{CHROME}/Cache"),
        &format!("{TEMP}/old"),
        &format!("{LOCAL}/npm-cache/_cacache"),
    ];
    let total: u64 = sizes.iter().map(|rel| m.size(rel)).sum();
    assert_eq!(found(&list), (3, total));
    assert!(
        list.items[1].folder.ends_with("Temp"),
        "{}",
        list.items[1].folder
    );
    assert!(!list.truncated);
    let cleanup = list.cleanup.as_ref().unwrap();
    assert!(!cleanup.approximate);
    assert_eq!(
        cleanup.info,
        [InfoDto {
            kind: InfoKind::Pagefile,
            path: Some(
                m.tree
                    .path(m.id("pagefile.sys"))
                    .to_string_lossy()
                    .into_owned()
            ),
            size: Some(m.size("pagefile.sys")),
            app: None,
            command: None,
        }]
    );

    let review = m.list("", ListKind::Review, 10);
    assert_eq!(names(&review), ["node_modules", "work", ".venv"]);
    assert_eq!(
        reasons(&review),
        [
            (Reason::NodeModules, None, Some(true)),
            (Reason::TempWork, None, None),
            (Reason::PythonVenv, None, Some(false)),
        ]
    );
    assert_eq!(found(&review).0, 3);
    assert_eq!(info(&review), [], "system places show in Cleanup only");

    let first = m.list("", ListKind::Cleanup, 1);
    assert_eq!(names(&first), ["Cache"]);
    assert!(first.truncated);
    assert_eq!(found(&first), (3, total), "totals ignore the limit");
}

#[test]
fn a_folder_lists_only_the_rows_inside_it() {
    let m = machine();
    let temp = m.list(TEMP, ListKind::Cleanup, 10);
    assert_eq!(names(&temp), ["old"]);
    assert_eq!(found(&temp), (1, m.size(&format!("{TEMP}/old"))));
    assert_eq!(info(&temp), [], "the pagefile is not in Temp");
    assert_eq!(names(&m.list(TEMP, ListKind::Review, 10)), ["work"]);

    // An installed program is a zone of "anywhere" rules.
    for kind in [ListKind::Cleanup, ListKind::Review] {
        let app = m.list("Program Files/App", kind, 10);
        assert!(app.items.is_empty(), "{kind:?}");
        assert_eq!(found(&app), (0, 0));
    }
    // A folder inside a row: the row is not inside it.
    let pkg = m.list("Users/u/proj/node_modules/pkg", ListKind::Review, 10);
    assert!(pkg.items.is_empty());
    assert_eq!(found(&pkg), (0, 0));
    // The row itself is on its own chain.
    let row = m.list("Users/u/proj/node_modules", ListKind::Review, 10);
    assert_eq!(names(&row), ["node_modules"]);
}

#[test]
fn a_running_browser_turns_its_rows_into_info() {
    let m = machine();
    m.running.lock().unwrap().push("chrome.exe");
    let list = m.list("", ListKind::Cleanup, 10);
    assert_eq!(names(&list), ["old", "_cacache"]);
    assert_eq!(found(&list).0, 2);
    let app = InfoDto {
        kind: InfoKind::AppRunning,
        path: None,
        size: Some(m.size(&format!("{CHROME}/Cache"))),
        app: Some("Google Chrome".into()),
        command: None,
    };
    assert!(info(&list).contains(&app), "{:?}", info(&list));
    let review = m.list("", ListKind::Review, 10);
    assert!(!info(&review).iter().any(|i| i.kind == InfoKind::AppRunning));
    let temp = m.list(TEMP, ListKind::Cleanup, 10);
    assert_eq!(info(&temp), [], "the browser's rows are not in Temp");

    m.running.lock().unwrap().clear();
    let list = m.list("", ListKind::Cleanup, 10);
    assert_eq!(names(&list)[0], "Cache", "processes are read for each list");
}

#[test]
fn only_the_clean_up_modes_build_the_context() {
    let m = machine();
    let largest = m.list("", ListKind::Largest, 10);
    assert_eq!((largest.found, largest.cleanup), (None, None));
    assert!(largest.items.iter().all(|i| i.reason.is_none()));
    assert_eq!(m.calls.load(Ordering::Relaxed), 0);
    m.list("", ListKind::Review, 10);
    assert_eq!(m.calls.load(Ordering::Relaxed), 1);
    assert_eq!(
        m.state
            .list(m.generation + 1, 0, ListKind::Cleanup, 10, None)
            .map(|_| ()),
        Err(crate::error::CmdError::StaleId)
    );
}

#[test]
fn info_lines_are_never_repeated_and_unreadable_places_make_it_approximate() {
    let m = machine();
    let (temp, old) = (m.id(TEMP), m.id(&format!("{TEMP}/old")));
    let cache = m.id(&format!("{CHROME}/Cache"));
    let no_access = |id| Info::NoAccess {
        id,
        path: String::new(),
    };
    let held = |mode| Info::AppRunning {
        app: "Google Chrome",
        mode,
        ids: vec![cache],
        size: 0,
    };
    let all = Cleanup {
        info: vec![
            no_access(old),
            no_access(old),
            no_access(m.id("pagefile.sys")),
            held(Mode::Cleanup),
            held(Mode::Review),
        ],
        ..Cleanup::default()
    };
    let (items, truncated, found, cleanup) =
        cleanup_rows(&m.tree, 0, Mode::Cleanup, 10, &all, None);
    assert!(items.is_empty() && !truncated);
    assert_eq!(found, FoundDto { count: 0, size: 0 });
    let kinds: Vec<InfoKind> = cleanup.info.iter().map(|i| i.kind).collect();
    assert_eq!(
        kinds,
        [InfoKind::NoAccess, InfoKind::NoAccess, InfoKind::AppRunning]
    );
    assert!(cleanup.approximate);

    let (.., cleanup) = cleanup_rows(&m.tree, temp, Mode::Review, 10, &all, None);
    let paths: Vec<_> = cleanup.info.iter().map(|i| i.path.clone()).collect();
    assert_eq!(
        paths,
        [Some(m.tree.path(old).to_string_lossy().into_owned())]
    );
    assert!(cleanup.approximate);
    let (.., cleanup) = cleanup_rows(&m.tree, cache, Mode::Review, 10, &Cleanup::default(), None);
    assert!(!cleanup.approximate);
}
