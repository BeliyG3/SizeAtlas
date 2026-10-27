//! Candidate files: one iterative walk over each root's tree, its big folders split off into
//! parallel tasks, picks the files that may have a copy, then they are bucketed by length. A
//! root inside another one is walked as a whole and left out of the outer walk, so every path
//! gives one candidate.

use std::sync::{Mutex, OnceLock, PoisonError};

use rayon::{ThreadPool, ThreadPoolBuilder};

use super::zones::{Mark, Zones, is_venv};
use super::{MIN_LEN, Options, SearchRoot};
use crate::cleanup::Os;
use crate::cleanup::paths::components;
use crate::cleanup::pattern::State;
use crate::tree::{Tree, flags};

/// A file that may have a copy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Candidate {
    /// Index into the searched roots.
    pub root: u16,
    pub node: u32,
    pub len: u64,
    pub size: u64,
    pub mtime: i64,
    /// Lies in a zone (only when zones are included): never removed.
    pub protected: bool,
    /// Lies in a cloud sync folder: removing it removes it on every device.
    pub synced: bool,
    /// Fits the query; a bucket needs one to be shown.
    pub seed: bool,
}

/// Every candidate of `roots`.
pub(crate) fn candidates(roots: &[SearchRoot], opts: &Options) -> Vec<Candidate> {
    collect(roots, opts).0
}

/// Candidates sharing one length, at least two with a seed among them, each in `(root, node)`
/// order.
pub(crate) fn buckets(mut c: Vec<Candidate>) -> Vec<Vec<Candidate>> {
    c.sort_unstable_by_key(|c| (c.len, c.root, c.node));
    c.chunk_by(|a, b| a.len == b.len)
        .filter(|g| g.len() >= 2 && g.iter().any(|c| c.seed))
        .map(<[Candidate]>::to_vec)
        .collect()
}

/// A folder holding at least this many nodes is walked as a task of its own.
const SPLIT: u32 = 4096;

/// Every candidate of `roots`, and the number of eligible files (see `Estimate::eligible`).
pub(super) fn collect(roots: &[SearchRoot], opts: &Options) -> (Vec<Candidate>, u64) {
    collect_split(roots, opts, SPLIT)
}

/// [`collect`], walking each folder of at least `split` nodes as a task of its own, in
/// parallel: the same candidates and count, in another order.
pub(super) fn collect_split(
    roots: &[SearchRoot],
    opts: &Options,
    split: u32,
) -> (Vec<Candidate>, u64) {
    let os = opts.os;
    // The path of each root that is not being scanned.
    let paths: Vec<Option<Vec<&str>>> = roots
        .iter()
        .map(|r| {
            let busy = r.tree.node(0).has(flags::PENDING | flags::SCANNING);
            (!busy).then(|| components(os, r.tree.name(0)))
        })
        .collect();
    let zones = Zones::new(os, opts.known);
    let walk = Walk {
        opts,
        zones: &zones,
        split,
    };
    let mut all = Part::default();
    for (i, root) in roots.iter().enumerate() {
        let Some(path) = &paths[i] else { continue };
        // The same root opened twice is walked once.
        let same_path = |p: &Vec<&str>| p.len() == path.len() && below(os, p, path);
        if paths[..i].iter().flatten().any(same_path) {
            continue;
        }
        let inner = paths.iter().enumerate().filter(|&(j, _)| j != i);
        let skip: Vec<u32> = inner
            .filter_map(|(_, p)| {
                let p = p.as_ref()?;
                let rest =
                    (p.len() > path.len() && below(os, path, p)).then(|| &p[path.len()..])?;
                find(root.tree, os, rest)
            })
            .collect();
        walk.root(&mut all, i as u16, root.tree, path, root.start, &skip);
    }
    (all.out, all.eligible)
}

/// Whether `path` starts with the components of `base`.
fn below(os: Os, base: &[&str], path: &[&str]) -> bool {
    base.len() <= path.len() && base.iter().zip(path).all(|(a, b)| same(os, a, b))
}

/// Names compare ignoring case on Windows.
fn same(os: Os, a: &str, b: &str) -> bool {
    a == b || (os == Os::Windows && a.to_lowercase() == b.to_lowercase())
}

/// The node at the relative path `rest`, if the tree has it.
fn find(tree: &Tree, os: Os, rest: &[&str]) -> Option<u32> {
    rest.iter().try_fold(0, |at, part| {
        tree.children(at).find(|&c| same(os, tree.name(c), part))
    })
}

struct Walk<'a> {
    opts: &'a Options<'a>,
    zones: &'a Zones<'a>,
    split: u32,
}

/// What one task of a walk found.
#[derive(Default)]
struct Part {
    out: Vec<Candidate>,
    eligible: u64,
    /// Reused for the lower-cased name of each node.
    buf: String,
}

/// One root being walked: which, its tree and the inner roots left out.
#[derive(Clone, Copy)]
struct At<'t> {
    index: u16,
    tree: &'t Tree,
    skip: &'t [u32],
}

/// A folder to walk, with the zone state and mark of its path.
type Folder = (u32, State, Mark);

/// The threads of the walks, apart from the global pool: a scan running there keeps its
/// threads busy and would hold an estimate back until it ends. `None` if none could start.
fn pool() -> Option<&'static ThreadPool> {
    static POOL: OnceLock<Option<ThreadPool>> = OnceLock::new();
    POOL.get_or_init(|| {
        ThreadPoolBuilder::new()
            .thread_name(|i| format!("dup-walk-{i}"))
            .build()
            .ok()
    })
    .as_ref()
}

impl Walk<'_> {
    /// Walks the subtree of `start` in the tree of root `index` at `path` into `all`, leaving
    /// out the nodes in `skip` (inner roots). `start` must be a live folder.
    fn root(
        &self,
        all: &mut Part,
        index: u16,
        tree: &Tree,
        path: &[&str],
        start: u32,
        skip: &[u32],
    ) {
        let live_dir = (start as usize) < tree.len() && {
            let node = tree.node(start);
            node.is_alive() && node.is_dir()
        };
        if !live_dir || tree.node(0).has(flags::LOSSY_NAME) {
            return;
        }
        let buf = &mut all.buf;
        // The root's name is a whole path: a zone on the way makes the whole root one.
        let (mut state, mut mark) = (self.zones.start(), Mark::default());
        for name in path {
            (state, mark) = self.zones.step(&state, mark, name, buf);
        }
        mark.zone |= is_venv(tree, 0);
        // Then down the folders to `start`, as the walk would go.
        let mut down = Vec::new();
        let mut at = start;
        while at != 0 {
            down.push(at);
            at = tree.node(at).parent;
        }
        for &id in down.iter().rev() {
            let node = tree.node(id);
            if skip.contains(&id) || node.has(flags::LOSSY_NAME) || !node.is_alive() {
                return;
            }
            (state, mark) = self.zones.step(&state, mark, tree.name(id), buf);
            mark.zone |= is_venv(tree, id);
        }
        let at = At { index, tree, skip };
        let parts = Mutex::new(Vec::new());
        let top = (start, state, mark);
        match pool() {
            Some(pool) => pool.scope(|s| self.task(s, &parts, at, top)),
            None => rayon::scope(|s| self.task(s, &parts, at, top)),
        }
        for part in parts.into_inner().unwrap_or_else(PoisonError::into_inner) {
            all.out.extend(part.out);
            all.eligible += part.eligible;
        }
    }

    /// Walks the subtree of `top` with a stack, each folder of at least `split` nodes below
    /// it as a task of its own, and leaves what it found in `parts`.
    fn task<'s>(
        &'s self,
        s: &rayon::Scope<'s>,
        parts: &'s Mutex<Vec<Part>>,
        at: At<'s>,
        top: Folder,
    ) {
        let (tree, mut part) = (at.tree, Part::default());
        let mut stack = vec![top];
        while let Some((dir, state, mark)) = stack.pop() {
            for id in tree.children(dir) {
                let node = tree.node(id);
                if at.skip.contains(&id) || node.has(flags::LOSSY_NAME) {
                    continue;
                }
                let (state, mut mark) = self.zones.step(&state, mark, tree.name(id), &mut part.buf);
                if !node.is_dir() {
                    self.file(&mut part, at, id, mark);
                    continue;
                }
                mark.zone |= is_venv(tree, id);
                if node.files.saturating_add(node.dirs) >= self.split {
                    s.spawn(move |s| self.task(s, parts, at, (id, state, mark)));
                } else {
                    stack.push((id, state, mark));
                }
            }
        }
        parts
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(part);
    }

    fn file(&self, part: &mut Part, at: At, id: u32, mark: Mark) {
        let (root, tree) = (at.index, at.tree);
        let node = tree.node(id);
        // A cloud placeholder has no data on disk; a second hard link (Unix) is no placeholder.
        let placeholder = node.size == 0 && node.len > 0 && !node.has(flags::HARDLINK);
        if node.len < MIN_LEN || placeholder {
            return;
        }
        part.eligible += 1;
        let query = self.opts.query;
        if query.is_some_and(|q| !q.filters().fits_size(node.len))
            || (mark.zone && !self.opts.include_zones)
        {
            return;
        }
        part.out.push(Candidate {
            root,
            node: id,
            len: node.len,
            size: node.size,
            mtime: node.mtime,
            protected: mark.zone,
            synced: mark.synced,
            seed: query.is_none_or(|q| q.seeds(node, tree.name(id), self.opts.now_ns)),
        });
    }
}
