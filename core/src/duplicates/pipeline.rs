//! The search: `prepare` copies the candidates out of the trees; `search` reads them in steps
//! (identity, prefix, tail, whole file) on a pool of readers per volume, and publishes a group
//! once the whole-file hash confirms it.

#[cfg(test)]
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Instant;

use serde::Serialize;

use super::cache::HashCache;
use super::candidates::{Candidate, buckets, candidates};
use super::group::{Group, Location, Object, PathRef};
use super::hash::{Hash, Skip, TAIL_FROM};
use super::pool::{self, Pacer, Place};
use super::{DiskKind, Options, SearchRoot};
use crate::platform::FileId;

mod read;
mod steps;

/// What the search compares: starts and ends of files (counted in files), or whole files
/// (counted in bytes).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Prefix,
    Full,
}

#[derive(Clone, Copy, Debug)]
pub struct Progress {
    pub phase: Phase,
    pub files_done: u64,
    pub files_total: u64,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[derive(Clone, Debug)]
pub enum Event {
    Progress(Progress),
    /// A group confirmed by the whole-file hash.
    Group(Group),
}

/// Files left out, by why (see [`Skip`]): each path that failed to open for its identity, then
/// each file (the merged paths of one) that failed a later open or read.
#[derive(Default, Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unread {
    pub cloud: u32,
    pub changed: u32,
    pub no_access: u32,
    pub failed: u32,
}

/// What the search opened and read.
#[derive(Default, Debug)]
pub struct Stats {
    /// Paths opened to tell their identity, once each; a cloud file or a failed open is not
    /// counted.
    pub opened: u64,
    pub prefix_reads: u64,
    pub tail_reads: u64,
    pub full_reads: u64,
}

#[derive(Debug)]
pub struct Outcome {
    /// Not cancelled.
    pub complete: bool,
    pub unread: Unread,
    pub stats: Stats,
}

/// The candidates of a search, copied out of the trees: paths in buckets of one length, and
/// the volumes they lie on.
pub struct Prepared {
    buckets: Vec<Vec<(Location, Candidate)>>,
    /// Key and disk of each volume; `Location::volume` indexes it.
    volumes: Vec<(String, DiskKind)>,
    /// Called with the path after every read of content, before the check that the file did
    /// not change.
    #[cfg(test)]
    pub(super) after_read: Option<fn(&Path)>,
}

/// What a search of `roots` with `opts` will read, taken from the trees in memory: once it
/// returns, the trees are no longer needed.
pub fn prepare(roots: &[SearchRoot], opts: &Options) -> Prepared {
    let mut volumes: Vec<(String, DiskKind)> = Vec::new();
    let volume_of: Vec<u16> = roots
        .iter()
        .map(|r| {
            let at = volumes.iter().position(|(key, _)| key == r.volume);
            at.unwrap_or_else(|| {
                volumes.push((r.volume.to_owned(), r.disk));
                volumes.len() - 1
            }) as u16
        })
        .collect();
    let locate = |c: Candidate| {
        let root = usize::from(c.root);
        let at = Location {
            at: PathRef {
                root: c.root,
                node: c.node,
            },
            path: roots[root].tree.path(c.node),
            len: c.len,
            mtime: c.mtime,
            size: c.size,
            volume: volume_of[root],
        };
        (at, c)
    };
    let buckets = buckets(candidates(roots, opts))
        .into_iter()
        .map(|bucket| bucket.into_iter().map(locate).collect())
        .collect();
    Prepared {
        buckets,
        volumes,
        #[cfg(test)]
        after_read: None,
    }
}

/// Reads the files of `prepared` and gives every group the whole-file hash confirms to `emit`,
/// with progress at most every [`pool::PACE`]. Hashes come from and go to `cache`. Once
/// `cancel` is set no file starts and no group is given.
pub fn search(
    prepared: Prepared,
    cache: &Mutex<HashCache>,
    cancel: &AtomicBool,
    emit: &(dyn Fn(Event) + Sync),
) -> Outcome {
    let (disks, keys) = prepared.volumes.into_iter().map(|(k, d)| (d, k)).unzip();
    let search = Search {
        disks,
        keys,
        cache,
        cancel,
        emit,
        progress: Mutex::new((
            Progress {
                phase: Phase::Prefix,
                files_done: 0,
                files_total: 0,
                bytes_done: 0,
                bytes_total: 0,
            },
            Pacer::default(),
        )),
        unread: Mutex::default(),
        stats: Mutex::default(),
        publish: Mutex::new(()),
        #[cfg(test)]
        after_read: prepared.after_read,
    };
    search.run(prepared.buckets);
    emit(Event::Progress(lock(&search.progress).0));
    Outcome {
        complete: !cancel.load(Ordering::Relaxed),
        unread: search
            .unread
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner),
        stats: search
            .stats
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner),
    }
}

/// An object being compared.
struct Item {
    object: Object,
    /// The id its first path had when first opened; every later open must find it again.
    seen: Option<FileId>,
    /// Its whole-file hash, once known.
    full: Option<Hash>,
}

struct Search<'a> {
    disks: Vec<DiskKind>,
    /// Volume keys, for the cache.
    keys: Vec<String>,
    cache: &'a Mutex<HashCache>,
    cancel: &'a AtomicBool,
    emit: &'a (dyn Fn(Event) + Sync),
    progress: Mutex<(Progress, Pacer)>,
    unread: Mutex<Unread>,
    stats: Mutex<Stats>,
    /// Held while checking `cancel` and giving a group, so none is given after a cancel.
    publish: Mutex<()>,
    #[cfg(test)]
    after_read: Option<fn(&Path)>,
}

impl Search<'_> {
    fn run(&self, buckets: Vec<Vec<(Location, Candidate)>>) {
        let paths = buckets.iter().map(Vec::len).sum::<usize>() as u64;
        let long = buckets
            .iter()
            .flatten()
            .filter(|(at, _)| at.len > TAIL_FROM);
        let long = long.count() as u64;
        // Every path is opened, then read for its prefix and maybe its tail, at most once
        // each; the total shrinks as each step finds less to read.
        self.advance(|p| p.files_total = 2 * paths + long);
        let objects = self.identify(buckets);
        if self.stopped() {
            return;
        }
        let found = objects.iter().map(Vec::len).sum::<usize>() as u64;
        self.advance(|p| p.files_total -= paths - found);
        let subs = self.prefixes(objects);
        if self.stopped() {
            return;
        }
        let subs = self.tails(subs, long);
        if self.stopped() {
            return;
        }
        self.fulls(subs);
    }

    /// Runs `work` on the pool of each volume, counting each job as a file done.
    fn pool<T: Sync, R: Send>(
        &self,
        jobs: &[T],
        place: impl Fn(&T) -> Place,
        work: impl Fn(&T) -> R + Sync,
    ) -> Vec<Option<R>> {
        pool::run(jobs, place, &self.disks, self.cancel, |job| {
            let r = work(job);
            self.advance(|p| p.files_done += 1);
            r
        })
    }

    /// Changes the progress, and gives it if one is due.
    fn advance(&self, change: impl FnOnce(&mut Progress)) {
        let now = Instant::now();
        let due = {
            let mut g = lock(&self.progress);
            change(&mut g.0);
            g.1.due(now).then_some(g.0)
        };
        if let Some(progress) = due {
            (self.emit)(Event::Progress(progress));
        }
    }

    fn left_out(&self, skip: Skip) {
        let mut u = lock(&self.unread);
        match skip {
            Skip::Cloud => u.cloud += 1,
            Skip::Changed => u.changed += 1,
            Skip::NoAccess => u.no_access += 1,
            Skip::Failed => u.failed += 1,
        }
    }

    fn stopped(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

fn place(at: &Location) -> Place {
    (at.volume, key(at))
}

fn key(at: &Location) -> (u16, u32) {
    (at.at.root, at.at.node)
}

/// The guarded value, also after a panic elsewhere: every value here is whole between
/// statements.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}
