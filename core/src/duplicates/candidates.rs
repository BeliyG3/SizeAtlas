//! Candidate files: one iterative walk over each root's tree picks the files that may have a
//! copy, then they are bucketed by length. A root inside another one is walked as a whole and
//! left out of the outer walk, so every path gives one candidate.

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

/// Every candidate of `roots`, and the number of eligible files (see `Estimate::eligible`).
pub(super) fn collect(roots: &[SearchRoot], opts: &Options) -> (Vec<Candidate>, u64) {
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
    let mut walk = Walk {
        opts,
        zones: &zones,
        out: Vec::new(),
        eligible: 0,
        buf: String::new(),
    };
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
        walk.root(i as u16, root.tree, path, root.start, &skip);
    }
    (walk.out, walk.eligible)
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
    out: Vec<Candidate>,
    eligible: u64,
    /// Reused for the lower-cased name of each node.
    buf: String,
}

impl Walk<'_> {
    /// Walks the subtree of `start` in the tree of root `index` at `path`, leaving out the
    /// nodes in `skip` (inner roots). `start` must be a live folder.
    fn root(&mut self, index: u16, tree: &Tree, path: &[&str], start: u32, skip: &[u32]) {
        let live_dir = (start as usize) < tree.len() && {
            let node = tree.node(start);
            node.is_alive() && node.is_dir()
        };
        if !live_dir || tree.node(0).has(flags::LOSSY_NAME) {
            return;
        }
        // The root's name is a whole path: a zone on the way makes the whole root one.
        let (mut state, mut mark) = (self.zones.start(), Mark::default());
        for name in path {
            (state, mark) = self.zones.step(&state, mark, name, &mut self.buf);
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
            (state, mark) = self.zones.step(&state, mark, tree.name(id), &mut self.buf);
            mark.zone |= is_venv(tree, id);
        }
        let mut stack: Vec<(u32, State, Mark)> = vec![(start, state, mark)];
        while let Some((dir, state, mark)) = stack.pop() {
            for id in tree.children(dir) {
                let node = tree.node(id);
                if skip.contains(&id) || node.has(flags::LOSSY_NAME) {
                    continue;
                }
                let (state, mut mark) = self.zones.step(&state, mark, tree.name(id), &mut self.buf);
                if node.is_dir() {
                    mark.zone |= is_venv(tree, id);
                    stack.push((id, state, mark));
                } else {
                    self.file(index, tree, id, mark);
                }
            }
        }
    }

    fn file(&mut self, root: u16, tree: &Tree, id: u32, mark: Mark) {
        let node = tree.node(id);
        // A cloud placeholder has no data on disk; a second hard link (Unix) is no placeholder.
        let placeholder = node.size == 0 && node.len > 0 && !node.has(flags::HARDLINK);
        if node.len < MIN_LEN || placeholder {
            return;
        }
        self.eligible += 1;
        let query = self.opts.query;
        if query.is_some_and(|q| !q.filters().fits_size(node.len))
            || (mark.zone && !self.opts.include_zones)
        {
            return;
        }
        self.out.push(Candidate {
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
