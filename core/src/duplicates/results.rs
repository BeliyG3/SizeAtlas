//! The result of one search job, kept for the app: every change bumps `version`, and a reader
//! asks for what changed after the version it saw. Events of any job but the current one are
//! ignored, so a late group of a cancelled search cannot reach the result.

use std::collections::HashSet;

use super::Unread;
use super::group::{Group, PathRef};
use super::hash::Hash;

/// A root as the search saw it: the result is stale once the root changes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RootMark {
    pub path: String,
    pub generation: u64,
    pub rev: u64,
}

/// What changed after a cursor.
pub struct Delta<'a> {
    /// The whole result, not a change: another job, or a first read.
    pub full: bool,
    pub groups: Vec<&'a Group>,
    pub removed: Vec<Hash>,
}

#[derive(Debug)]
pub struct Results {
    pub job: u64,
    pub version: u64,
    pub complete: bool,
    pub unread: Unread,
    pub roots: Vec<RootMark>,
    /// Each group with the version it last changed at; groups of the earlier job start at 0.
    groups: Vec<(Group, u64)>,
    /// Groups gone after version `.1`.
    removed: Vec<(Hash, u64)>,
    /// Groups taken over from the earlier job and not found again yet.
    carried: HashSet<Hash>,
}

impl Results {
    /// An empty result of `job`. With `previous` (the earlier job with the same query and
    /// roots) its groups are shown until this job finishes and drops those it did not find.
    pub fn new(job: u64, roots: Vec<RootMark>, previous: Option<&Results>) -> Results {
        let groups: Vec<_> = previous
            .map(|p| p.groups.iter().map(|(g, _)| (g.clone(), 0)).collect())
            .unwrap_or_default();
        Results {
            job,
            version: 0,
            complete: false,
            unread: Unread::default(),
            roots,
            carried: groups.iter().map(|(g, _)| g.hash).collect(),
            groups,
            removed: Vec::new(),
        }
    }

    /// Adds `group`, or replaces the one with its hash. `false` when `job` is not the current
    /// one.
    pub fn upsert(&mut self, job: u64, group: Group) -> bool {
        if job != self.job {
            return false;
        }
        self.version += 1;
        self.carried.remove(&group.hash);
        self.removed.retain(|(h, _)| *h != group.hash);
        let entry = (group, self.version);
        match self.groups.iter_mut().find(|(g, _)| g.hash == entry.0.hash) {
            Some(slot) => *slot = entry,
            None => self.groups.push(entry),
        }
        true
    }

    /// Ends `job`. When `complete`, groups the job did not find again are gone. `false` when
    /// `job` is not the current one.
    pub fn finish(&mut self, job: u64, complete: bool, unread: Unread) -> bool {
        if job != self.job {
            return false;
        }
        self.version += 1;
        self.complete = complete;
        self.unread = unread;
        if complete {
            let carried = std::mem::take(&mut self.carried);
            self.drop_where(|g| carried.contains(&g.hash));
        }
        true
    }

    /// The group holding the path and the index of the object it belongs to.
    // ponytail: linear scan; an index by path if groups reach hundreds of thousands.
    pub fn find(&self, at: PathRef) -> Option<(&Group, usize)> {
        self.groups.iter().find_map(|(g, _)| {
            let i = g
                .objects
                .iter()
                .position(|o| o.paths.iter().any(|p| p.at == at))?;
            Some((g, i))
        })
    }

    /// Takes paths out of the groups after they left the disk: an object without paths goes,
    /// and so does a group left with fewer than two objects.
    pub fn remove(&mut self, gone: &[PathRef]) {
        let touched = |g: &Group| {
            g.objects
                .iter()
                .any(|o| o.paths.iter().any(|p| gone.contains(&p.at)))
        };
        if !self.groups.iter().any(|(g, _)| touched(g)) {
            return;
        }
        self.version += 1;
        let version = self.version;
        for (g, seq) in &mut self.groups {
            if touched(g) {
                for o in &mut g.objects {
                    o.paths.retain(|p| !gone.contains(&p.at));
                }
                g.objects.retain(|o| !o.paths.is_empty());
                *seq = version;
            }
        }
        self.drop_where(|g| g.objects.len() < 2);
    }

    /// Flags the group: the disk may no longer match it.
    pub fn mark_stale(&mut self, hash: &Hash) {
        let version = self.version + 1;
        if let Some((g, seq)) = self.groups.iter_mut().find(|(g, _)| g.hash == *hash) {
            g.stale = true;
            *seq = version;
            self.version = version;
        }
    }

    /// What changed after `cursor`; everything for another job or the cursor 0.
    pub fn since(&self, job: u64, cursor: u64) -> Delta<'_> {
        if job != self.job || cursor == 0 {
            return Delta {
                full: true,
                groups: self.groups().collect(),
                removed: Vec::new(),
            };
        }
        Delta {
            full: false,
            groups: self
                .groups
                .iter()
                .filter(|(_, seq)| *seq > cursor)
                .map(|(g, _)| g)
                .collect(),
            removed: self
                .removed
                .iter()
                .filter(|(_, seq)| *seq > cursor)
                .map(|(h, _)| *h)
                .collect(),
        }
    }

    pub fn groups(&self) -> impl Iterator<Item = &Group> {
        self.groups.iter().map(|(g, _)| g)
    }

    /// Drops the groups `gone` picks, at the current version.
    fn drop_where(&mut self, gone: impl Fn(&Group) -> bool) {
        let version = self.version;
        let removed = &mut self.removed;
        self.groups.retain(|(g, _)| {
            let drop = gone(g);
            if drop {
                removed.push((g.hash, version));
            }
            !drop
        });
    }
}
