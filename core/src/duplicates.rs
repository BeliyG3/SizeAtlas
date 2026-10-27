//! Duplicate files across every open root: candidates picked from the scanned trees (zones,
//! filter seeds, buckets by length), before any file is read; then files opened with their
//! identity checked, hashed, and merged into groups.

use crate::cleanup::{Known, Os};
use crate::tree::{Query, Tree};

pub mod cache;
mod candidates;
pub mod group;
pub mod hash;
mod held;
mod pipeline;
mod pool;
pub mod results;
mod zones;

pub use crate::platform::{FileId, Identity};
pub use hash::Skip;
pub use held::{Held, rehash_held};
pub use pipeline::{Event, Outcome, Phase, Prepared, Progress, Stats, Unread, prepare, search};

/// Smaller files are never compared: they free too little to be worth reading.
pub const MIN_LEN: u64 = 4096;

/// The kind of disk a root lies on; it decides how many files are read at once.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiskKind {
    Ssd,
    Hdd,
    Unknown,
}

impl DiskKind {
    /// Readers per volume: parallel reads only help an SSD, they make a disk head seek.
    pub fn threads(self) -> usize {
        match self {
            DiskKind::Ssd => 4,
            DiskKind::Hdd | DiskKind::Unknown => 1,
        }
    }
}

/// One open root to search.
#[derive(Clone, Copy, Debug)]
pub struct SearchRoot<'a> {
    pub tree: &'a Tree,
    pub generation: u64,
    /// The key of the root's volume; file ids are compared only within one volume.
    pub volume: &'a str,
    pub disk: DiskKind,
    /// The node the walk starts at: 0 for the whole root, else a folder in it (zones still
    /// count from the root's path down to it). A file or a dead node gives no candidates.
    pub start: u32,
}

/// What a search looks for.
#[derive(Clone, Copy, Debug)]
pub struct Options<'a> {
    /// Picks the seed files; `None` seeds every candidate.
    pub query: Option<&'a Query>,
    /// Zones give protected candidates instead of none.
    pub include_zones: bool,
    pub os: Os,
    pub known: &'a Known,
    /// What `older:` and `newer:` count back from, ns since the epoch.
    pub now_ns: i64,
}

/// What a search would compare, shown before it starts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Estimate {
    /// Candidates whose length another candidate shares, in buckets with a seed.
    pub files: u64,
    /// Their summed lengths.
    pub bytes: u64,
    /// Live files of at least [`MIN_LEN`], not lossy, not cloud placeholders, before zones
    /// and filters.
    pub eligible: u64,
    /// Seeds among the candidates, before buckets by length.
    pub seeded: u64,
}

/// What a search of `roots` with `opts` would compare.
pub fn estimate(roots: &[SearchRoot], opts: &Options) -> Estimate {
    let (found, eligible) = candidates::collect(roots, opts);
    let seeded = found.iter().filter(|c| c.seed).count() as u64;
    // The buckets of `candidates::buckets`, counted from the lengths alone: sorting whole
    // candidates and copying them out would take longer than the walk.
    let mut lens: Vec<(u64, bool)> = found.iter().map(|c| (c.len, c.seed)).collect();
    lens.sort_unstable();
    let (mut files, mut bytes) = (0, 0);
    for g in lens.chunk_by(|a, b| a.0 == b.0) {
        if g.len() >= 2 && g.iter().any(|&(_, seed)| seed) {
            files += g.len() as u64;
            bytes += g[0].0 * g.len() as u64;
        }
    }
    Estimate {
        files,
        bytes,
        eligible,
        seeded,
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_candidates;
#[cfg(test)]
mod tests_group;
#[cfg(test)]
mod tests_hash;
#[cfg(test)]
mod tests_held;
#[cfg(test)]
mod tests_links;
#[cfg(test)]
mod tests_parallel;
#[cfg(test)]
mod tests_results;
#[cfg(test)]
mod tests_scope;
#[cfg(test)]
mod tests_search;
#[cfg(test)]
mod tests_unread;
#[cfg(test)]
mod tests_zones;
