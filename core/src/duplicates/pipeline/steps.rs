//! The steps of a search: identity, prefix, tail and whole file, each one splitting the groups
//! of the step before; and publishing the groups the whole-file hash confirms.

use std::collections::HashMap;
use std::mem;
use std::sync::Mutex;

use super::{Event, Item, Phase, Progress, Search, key, lock, place};
use crate::duplicates::candidates::Candidate;
use crate::duplicates::group::{Group, Location, Object, merge_by_id};
use crate::duplicates::hash::{Hash, PREFIX, Skip, TAIL_FROM, open_checked};
use crate::platform::{FileId, Identity};

impl Search<'_> {
    /// Opens every path for its identity, reading nothing, and merges the paths of one file.
    pub(super) fn identify(&self, buckets: Vec<Vec<(Location, Candidate)>>) -> Vec<Vec<Item>> {
        let count = buckets.len();
        let jobs: Vec<(usize, Location, Candidate)> = buckets
            .into_iter()
            .enumerate()
            .flat_map(|(b, paths)| paths.into_iter().map(move |(at, c)| (b, at, c)))
            .collect();
        let found = self.pool(
            &jobs,
            |(_, at, _)| place(at),
            |(_, at, _)| open_checked(&at.path, at.len, at.mtime).map(|(_, id, _)| id),
        );
        let mut opened: Vec<Vec<_>> = (0..count).map(|_| Vec::new()).collect();
        for ((b, at, c), found) in jobs.into_iter().zip(found) {
            match found {
                Some(Ok(identity)) => {
                    lock(&self.stats).opened += 1;
                    opened[b].push((at, identity, c));
                }
                Some(Err(skip)) => self.left_out(skip),
                None => {}
            }
        }
        let items = |paths: Vec<_>| {
            let seen: HashMap<(u16, u32), Option<FileId>> = paths
                .iter()
                .map(|(at, identity, _): &(Location, Identity, _)| (key(at), identity.id))
                .collect();
            merge_by_id(paths)
                .into_iter()
                .map(|object| Item {
                    seen: seen[&key(&object.paths[0])],
                    object,
                    full: None,
                })
                .collect::<Vec<_>>()
        };
        let objects = opened.into_iter().map(items);
        objects
            .filter(|items| worth(items, |i| &i.object))
            .collect()
    }

    /// Reads the prefix of every object (or takes it from the cache) and splits by it; a group
    /// of short files is whole and published, the others go on.
    pub(super) fn prefixes(&self, buckets: Vec<Vec<Item>>) -> Vec<Vec<Item>> {
        let mut next = Vec::new();
        for bucket in self.read_all(buckets, |item| self.prefix(item)) {
            let keyed = bucket.into_iter().map(|(mut item, (prefix, full))| {
                item.full = full;
                (item, prefix)
            });
            for (_, sub) in split(keyed.collect(), |i| &i.object) {
                if sub[0].object.paths[0].len <= PREFIX as u64 {
                    self.publish(&sub, sub.iter().map(|i| i.full).collect());
                } else {
                    next.push(sub);
                }
            }
        }
        next
    }

    /// Splits by their tails the long files of `subs` with no known whole-file hash; when one
    /// file of a group has it, the others go straight to their whole-file hash. `bound` is the
    /// number of tails planned for at the start.
    pub(super) fn tails(&self, subs: Vec<Vec<Item>>, bound: u64) -> Vec<Vec<Item>> {
        let (long, mut next): (Vec<_>, Vec<_>) = subs.into_iter().partition(|sub| {
            sub[0].object.paths[0].len > TAIL_FROM && sub.iter().all(|i| i.full.is_none())
        });
        let count = long.iter().map(Vec::len).sum::<usize>() as u64;
        self.advance(|p| p.files_total -= bound - count);
        for sub in self.read_all(long, |item| self.tail(item)) {
            next.extend(split(sub, |i| &i.object).into_iter().map(|(_, sub)| sub));
        }
        next
    }

    /// Hashes the whole files the cache does not know, and publishes each group as soon as all
    /// its files are hashed.
    pub(super) fn fulls(&self, subs: Vec<Vec<Item>>) {
        let jobs: Vec<(usize, usize)> = subs
            .iter()
            .enumerate()
            .flat_map(|(s, sub)| {
                let unknown = sub.iter().enumerate().filter(|(_, i)| i.full.is_none());
                unknown.map(move |(k, _)| (s, k))
            })
            .collect();
        let bytes = jobs
            .iter()
            .map(|&(s, k)| subs[s][k].object.paths[0].len)
            .sum();
        self.advance(|p| {
            *p = Progress {
                phase: Phase::Full,
                files_done: 0,
                files_total: jobs.len() as u64,
                bytes_done: 0,
                bytes_total: bytes,
            }
        });
        // Per group: files still to hash, and the whole-file hash of each file.
        let waiting: Vec<Mutex<(usize, Vec<Option<Hash>>)>> = subs
            .iter()
            .map(|sub| {
                let left = sub.iter().filter(|i| i.full.is_none()).count();
                Mutex::new((left, sub.iter().map(|i| i.full).collect()))
            })
            .collect();
        for (sub, waiting) in subs.iter().zip(&waiting) {
            let mut w = lock(waiting);
            if w.0 == 0 {
                let fulls = mem::take(&mut w.1);
                drop(w);
                self.publish(sub, fulls);
            }
        }
        let place_of = |&(s, k): &(usize, usize)| place(&subs[s][k].object.paths[0]);
        self.pool(&jobs, place_of, |&(s, k)| {
            let hash = self.full(&subs[s][k]);
            let mut w = lock(&waiting[s]);
            match hash {
                Ok(hash) => w.1[k] = hash,
                Err(skip) => self.left_out(skip),
            }
            w.0 -= 1;
            if w.0 == 0 {
                let fulls = mem::take(&mut w.1);
                drop(w);
                self.publish(&subs[s], fulls);
            }
        });
    }

    /// Runs `read` on every item of `subs`; gives each sub's items read, with what was read.
    fn read_all<R: Send>(
        &self,
        subs: Vec<Vec<Item>>,
        read: impl Fn(&Item) -> Result<R, Skip> + Sync,
    ) -> Vec<Vec<(Item, R)>> {
        let count = subs.len();
        let jobs: Vec<(usize, Item)> = subs
            .into_iter()
            .enumerate()
            .flat_map(|(s, sub)| sub.into_iter().map(move |item| (s, item)))
            .collect();
        let found = self.pool(&jobs, |(_, i)| place(&i.object.paths[0]), |(_, i)| read(i));
        let mut out: Vec<Vec<_>> = (0..count).map(|_| Vec::new()).collect();
        for ((s, item), found) in jobs.into_iter().zip(found) {
            match found {
                Some(Ok(r)) => out[s].push((item, r)),
                Some(Err(skip)) => self.left_out(skip),
                None => {}
            }
        }
        out
    }

    /// Publishes the groups of `items` by their whole-file hashes `fulls` (`None`: unread).
    fn publish(&self, items: &[Item], fulls: Vec<Option<Hash>>) {
        let len = items[0].object.paths[0].len;
        let known = items.iter().zip(fulls);
        let known = known.filter_map(|(i, h)| Some((i.object.clone(), h?)));
        for (hash, objects) in split(known.collect(), |o| o) {
            let _one = lock(&self.publish);
            if self.stopped() {
                return;
            }
            (self.emit)(Event::Group(Group {
                hash,
                len,
                objects,
                stale: false,
            }));
        }
    }
}

/// Worth reading on: two objects or more, one of them a seed.
fn worth<T>(items: &[T], object: impl Fn(&T) -> &Object) -> bool {
    items.len() >= 2 && items.iter().any(|t| object(t).seed)
}

/// `items` split by hash, each part in the order of `items`; only parts worth reading on.
fn split<T>(mut items: Vec<(T, Hash)>, object: impl Fn(&T) -> &Object) -> Vec<(Hash, Vec<T>)> {
    // Stable: the files of one hash keep their `(root, node)` order.
    items.sort_by_key(|(_, hash)| *hash);
    let mut parts: Vec<(Hash, Vec<T>)> = Vec::new();
    for (t, hash) in items {
        match parts.last_mut() {
            Some((last, part)) if *last == hash => part.push(t),
            _ => parts.push((hash, vec![t])),
        }
    }
    parts.retain(|(_, part)| worth(part, &object));
    parts
}
