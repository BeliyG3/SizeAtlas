//! Tree builder, stub rules and contexts shared by the clean-up tests.

use std::collections::HashMap;

use super::*;
use crate::tree::{DirRec, FileRec, NO_PARENT, ScanMeta, SizeMode};

/// Time of the scan, seconds.
pub(super) const NOW: i64 = 1_800_000_000;

/// A modification time `days` before the scan, in ns.
pub(super) fn ago(days: i64) -> i64 {
    (NOW - days * 86_400) * 1_000_000_000
}

/// A file, or a folder when the path ends with a separator. 10 bytes, 30 days old.
pub(super) struct Item {
    path: String,
    size: u64,
    mtime: i64,
    flags: u8,
}

pub(super) fn it(path: impl Into<String>) -> Item {
    Item {
        path: path.into(),
        size: 10,
        mtime: ago(30),
        flags: 0,
    }
}

impl Item {
    pub(super) fn path(&self) -> &str {
        &self.path
    }
    pub(super) fn size(self, size: u64) -> Item {
        Item { size, ..self }
    }
    pub(super) fn mtime(self, mtime: i64) -> Item {
        Item { mtime, ..self }
    }
    pub(super) fn flags(self, flags: u8) -> Item {
        Item { flags, ..self }
    }
}

/// A tree under `root` holding `items` and every folder on their way (30 days old).
pub(super) fn build(root: &str, items: Vec<Item>) -> Tree {
    let dir = |id, parent, name: &str| DirRec {
        id,
        parent,
        name: name.into(),
        mtime: ago(30),
        flags: 0,
        files: vec![],
    };
    let mut recs = vec![dir(0, NO_PARENT, root)];
    let mut ids = HashMap::from([(String::new(), 0u32)]);
    let mut dir_id = |recs: &mut Vec<DirRec>, path: &str| -> u32 {
        let mut parent = 0;
        let mut key = String::new();
        for part in path.split(['\\', '/']).filter(|p| !p.is_empty()) {
            key = format!("{key}/{part}");
            parent = *ids.entry(key.clone()).or_insert_with(|| {
                let id = recs.len() as u32;
                recs.push(dir(id, parent, part));
                id
            });
        }
        parent
    };
    for item in items {
        if item.path.ends_with(['\\', '/']) {
            let id = dir_id(&mut recs, &item.path) as usize;
            recs[id].mtime = item.mtime;
            recs[id].flags = item.flags;
        } else {
            let (parent, name) = item
                .path
                .rsplit_once(['\\', '/'])
                .unwrap_or(("", &item.path));
            let id = dir_id(&mut recs, parent) as usize;
            recs[id].files.push(FileRec {
                name: name.into(),
                size: item.size,
                len: item.size,
                mtime: item.mtime,
                flags: item.flags,
                ino: None,
            });
        }
    }
    let meta = ScanMeta {
        cluster: 0,
        size_mode: SizeMode::Logical,
        scanned_at: NOW,
    };
    Tree::from_records(recs, meta)
}

/// The node at `path` below the root.
pub(super) fn id(tree: &Tree, path: &str) -> u32 {
    path.split(['\\', '/']).fold(0, |at, part| {
        tree.children(at)
            .find(|&c| tree.name(c) == part)
            .unwrap_or_else(|| panic!("no {part} in {path}"))
    })
}

/// The path of `id` below the root, joined with `\`.
pub(super) fn rel(tree: &Tree, mut id: u32) -> String {
    let mut parts = Vec::new();
    while id != 0 {
        parts.push(tree.name(id));
        id = tree.node(id).parent;
    }
    parts.reverse();
    parts.join("\\")
}

/// Paths of the Cleanup rows and of the Review rows, sorted.
pub(super) fn listed(tree: &Tree, out: &Cleanup) -> (Vec<String>, Vec<String>) {
    let paths = |rows: &[Row]| {
        let mut v: Vec<String> = rows.iter().map(|r| rel(tree, r.id)).collect();
        v.sort();
        v
    };
    (paths(&out.cleanup), paths(&out.review))
}

pub(super) fn win() -> Context {
    let s = |s: &str| s.to_owned();
    Context {
        os: Os::Windows,
        known: Known {
            home: s(r"C:\Users\u"),
            local: s(r"C:\Users\u\AppData\Local"),
            local_low: s(r"C:\Users\u\AppData\LocalLow"),
            roaming: s(r"C:\Users\u\AppData\Roaming"),
            temp: s(r"C:\Users\u\AppData\Local\Temp"),
            system_root: s(r"C:\Windows"),
            program_data: s(r"C:\ProgramData"),
            system_drive: s(r"C:\"),
            program_files: vec![s(r"C:\Program Files"), s(r"C:\Program Files (x86)")],
            users: Some(s(r"C:\Users")),
            cloud: vec![s(r"C:\Users\u\OneDrive")],
            ..Known::default()
        },
        running: vec![],
        reboot_pending: false,
        recyclable: true,
    }
}

pub(super) const DISCORD: App = App {
    name: "Discord",
    exes: &["discord*.exe"],
    cmds: &[],
};
pub(super) const NPM: App = App {
    name: "npm",
    exes: &[],
    cmds: &[("node.exe", "npm-cli.js")],
};

const TEMP_AGE: Option<Age> = Some(Age {
    days: 7,
    young: None,
});

pub(super) const RULES: &[Rule] = &[
    Rule {
        temp: true,
        age: TEMP_AGE,
        ..Rule::new(
            Place::At(At::Temp, &[]),
            Target::Any("*"),
            Mode::Cleanup,
            Reason::TempOld,
        )
    },
    Rule {
        temp: true,
        reboot_blocks: true,
        age: TEMP_AGE,
        ..Rule::new(
            Place::At(At::SystemRoot, &["Temp"]),
            Target::Any("*"),
            Mode::Cleanup,
            Reason::TempOld,
        )
    },
    Rule {
        age: Some(Age {
            days: 14,
            young: Some((Mode::Review, Reason::CrashDumpRecent)),
        }),
        ..Rule::new(
            Place::At(At::Local, &["CrashDumps"]),
            Target::File("*.dmp"),
            Mode::Cleanup,
            Reason::CrashDump,
        )
    },
    Rule {
        app: Some(&DISCORD),
        ..Rule::new(
            Place::At(At::Roaming, &["discord*"]),
            Target::Dir("Code Cache"),
            Mode::Cleanup,
            Reason::AppCache,
        )
    },
    Rule {
        app: Some(&NPM),
        command: Some("npm cache clean --force"),
        ..Rule::new(
            Place::At(At::NpmCache, &[]),
            Target::Dir("_cacache"),
            Mode::Cleanup,
            Reason::PackageCache,
        )
    },
    Rule {
        marker: Some(Marker::Sibling("Preferences")),
        ..Rule::new(
            Place::At(At::Local, &["Google", "Chrome", "User Data", "*"]),
            Target::Dir("Cache"),
            Mode::Cleanup,
            Reason::BrowserCache,
        )
    },
    Rule {
        marker: Some(Marker::Sibling("package.json")),
        ..Rule::new(
            Place::Anywhere,
            Target::Dir("node_modules"),
            Mode::Review,
            Reason::NodeModules,
        )
    },
    Rule {
        marker: Some(Marker::Inside("pyvenv.cfg")),
        ..Rule::new(
            Place::Anywhere,
            Target::Dir(".venv"),
            Mode::Review,
            Reason::PythonVenv,
        )
    },
    Rule {
        marker: Some(Marker::Only(&["*.pyc", "*.pyo"])),
        ..Rule::new(
            Place::Anywhere,
            Target::Dir("__pycache__"),
            Mode::Cleanup,
            Reason::PythonBytecode,
        )
    },
];

pub(super) fn run(tree: &Tree, ctx: &Context) -> Cleanup {
    tree.cleanup_with(ctx, RULES, &[])
}
