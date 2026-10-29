//! The island of an open root: its neighbours are the other open drives, the disks give the free
//! space, and the built islands are kept in memory, one per open root.

use std::collections::HashMap;
use std::path::Path;
#[cfg(test)]
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex};

use sizeatlas_core::cache::fnv1a64;
use sizeatlas_core::city;
use sizeatlas_core::tree::{Tree, VolumeUsage};

use super::AppState;
use crate::error::CmdError;
use crate::sources;

/// Islands in the world.
const MAX_ISLANDS: usize = 8;

/// Free space is rounded down to this many bytes: a busy disk changes it all the time, and a
/// few MiB do not show on an island, but each change would miss the memory.
const FREE_STEP: u64 = 16 << 20;

/// A path as folder names, so that `C:\A` does not contain `C:\AB`; case does not count on
/// Windows.
fn parts(path: &str) -> Vec<String> {
    path.split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            if cfg!(windows) {
                part.to_lowercase()
            } else {
                part.to_owned()
            }
        })
        .collect()
}

/// An open root that is a whole drive: one island of the archipelago.
#[derive(Clone, Debug, PartialEq)]
pub struct Member {
    pub generation: u64,
    pub root: String,
    pub used: u64,
    /// Free bytes, rounded down to [`FREE_STEP`].
    pub free: u64,
}

/// The archipelago: of the open roots `(generation, root, used)` those that are a mount point of
/// `mounts` (a folder is not an island), the biggest [`MAX_ISLANDS`], by `used` downwards. The
/// order is by size, so every island sees the same world whichever root is selected.
pub fn members(
    open: &[(u64, String, u64)],
    mounts: &[String],
    free_of: impl Fn(&str) -> u64,
) -> Vec<Member> {
    let mounts: Vec<Vec<String>> = mounts.iter().map(|m| parts(m)).collect();
    let mut list: Vec<Member> = open
        .iter()
        .filter(|(_, root, _)| mounts.contains(&parts(root)))
        .map(|(generation, root, used)| Member {
            generation: *generation,
            root: root.clone(),
            used: *used,
            free: step(free_of(root)),
        })
        .collect();
    list.sort_by(|a, b| b.used.cmp(&a.used).then_with(|| a.root.cmp(&b.root)));
    list.truncate(MAX_ISLANDS);
    list
}

/// `free` rounded down to [`FREE_STEP`].
fn step(free: u64) -> u64 {
    free - free % FREE_STEP
}

/// Free bytes on the disk of `root`: the one with the longest mount point that contains it
/// (`(mount, available)` of the disks that answer); else what the saved scan knew; else 0.
pub fn free_space(root: &str, disks: &[(String, u64)], cached: Option<VolumeUsage>) -> u64 {
    let root = parts(root);
    disks
        .iter()
        .map(|(mount, available)| (parts(mount), *available))
        .filter(|(mount, _)| root.starts_with(mount))
        .max_by_key(|(mount, _)| mount.len())
        .map(|(_, available)| available)
        .or_else(|| cached.map(|v| v.total.saturating_sub(v.used)))
        .unwrap_or(0)
}

/// What an island map depends on: the same key gives the same bytes.
#[derive(PartialEq)]
struct CityKey {
    rev: u64,
    /// Free bytes of this island's own disk (rounded).
    free: u64,
    /// `(used, free)` of every member: the directions to the other islands come from them.
    islands: Vec<(u64, u64)>,
}

/// A built island map: its key, the island and the encoded bytes.
type Built = (CityKey, Arc<city::Island>, Vec<u8>);

/// The island map of every open root, by generation.
#[derive(Default)]
pub struct CityCache {
    kept: Mutex<HashMap<u64, Built>>,
    /// How many maps were built, for the tests.
    #[cfg(test)]
    pub builds: AtomicUsize,
}

impl CityCache {
    /// The bytes kept for `generation` under `key`, else what `build()` gives, stored. Entries of
    /// generations not in `open` are dropped. Building takes no lock, so two calls with a new
    /// key may both build.
    fn get_or_build(
        &self,
        generation: u64,
        key: CityKey,
        open: &[u64],
        build: impl FnOnce() -> (Arc<city::Island>, Vec<u8>),
    ) -> Vec<u8> {
        let lock = || self.kept.lock().unwrap_or_else(|e| e.into_inner());
        {
            let mut kept = lock();
            kept.retain(|g, _| open.contains(g));
            if let Some((have, _, bytes)) = kept.get(&generation)
                && *have == key
            {
                return bytes.clone();
            }
        }
        #[cfg(test)]
        self.builds
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let (island, bytes) = build();
        lock().insert(generation, (key, island, bytes.clone()));
        bytes
    }

    /// The island last built for `generation`, if it is still open.
    // Read by the placement and the bridges of the archipelago (next task).
    #[allow(dead_code)]
    pub fn island(&self, generation: u64) -> Option<Arc<city::Island>> {
        let kept = self.kept.lock().unwrap_or_else(|e| e.into_inner());
        kept.get(&generation).map(|(_, island, _)| island.clone())
    }
}

/// Every mount point, and `(mount, free bytes)` of the disks that answer.
fn survey(cache_dir: &Path) -> (Vec<String>, Vec<(String, u64)>) {
    let known = sources::list(cache_dir);
    let mounts = known.disks.iter().map(|d| d.mount.clone()).collect();
    let disks = known
        .disks
        .into_iter()
        .filter(|d| d.connected)
        .map(|d| (d.mount, d.available))
        .collect();
    (mounts, disks)
}

/// [`members`] of the open `trees`; a drive no disk answers for has the free space its scan knew.
fn members_of(
    trees: &[(u64, Arc<Tree>)],
    mounts: &[String],
    disks: &[(String, u64)],
) -> Vec<Member> {
    let open: Vec<(u64, String, u64)> = trees
        .iter()
        .map(|(g, t)| (*g, t.name(0).to_owned(), t.node(0).size))
        .collect();
    let free_of = |root: &str| {
        let cached = trees
            .iter()
            .find(|(_, t)| t.name(0) == root)
            .and_then(|(_, t)| t.volume);
        free_space(root, disks, cached)
    };
    members(&open, mounts, free_of)
}

impl AppState {
    /// The islands of the archipelago: the open drives (see [`members`]).
    // Read by the placement and the bridges of the archipelago (next task).
    #[allow(dead_code)]
    pub fn members(&self, cache_dir: &Path) -> Vec<Member> {
        let (mounts, disks) = survey(cache_dir);
        members_of(&self.open_trees(), &mounts, &disks)
    }

    /// Encoded island map of the whole root `generation` (see `sizeatlas_core::city`). Its
    /// neighbours are the other open drives; a root that is not a drive has none.
    pub fn city(&self, generation: u64, cache_dir: &Path) -> Result<Vec<u8>, CmdError> {
        // A stale generation answers before the disks are listed.
        self.with_live(generation, 0, |_| ())?;
        let (mounts, disks) = survey(cache_dir);
        self.city_in(generation, &mounts, &disks)
    }

    /// [`AppState::city`] with the mount points and the free space of the disks given.
    fn city_in(
        &self,
        generation: u64,
        mounts: &[String],
        disks: &[(String, u64)],
    ) -> Result<Vec<u8>, CmdError> {
        self.with_live(generation, 0, |tree| {
            let trees = self.open_trees();
            let list = members_of(&trees, mounts, disks);
            let root = tree.name(0);
            let me = list.iter().position(|m| m.generation == generation);
            let free = match me {
                Some(me) => list[me].free,
                None => step(free_space(root, disks, tree.volume)),
            };
            let (islands, neighbours) = match me {
                Some(me) => {
                    let islands: Vec<(u64, u64)> = list.iter().map(|m| (m.used, m.free)).collect();
                    let neighbours = city::directions(&islands, me);
                    (islands, neighbours)
                }
                None => (Vec::new(), Vec::new()),
            };
            let open: Vec<u64> = trees.iter().map(|(g, _)| *g).collect();
            let key = CityKey {
                rev: tree.rev,
                free,
                islands,
            };
            self.0.city.get_or_build(generation, key, &open, || {
                let input = city::IslandInput {
                    root: city::island_summary(tree, 0),
                    free,
                    neighbours,
                    seed: fnv1a64(root.as_bytes()),
                };
                let island = city::island(&input);
                let bytes = city::encode_city(generation, tree.rev, tree.approximate, &island);
                (Arc::new(island), bytes)
            })
        })
    }
}

#[cfg(test)]
#[path = "island_tests.rs"]
mod tests;
