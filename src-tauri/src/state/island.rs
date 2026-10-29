//! The island of an open root: its neighbours are the other open drives, the disks give the free
//! space, and the built islands are kept in memory, the last two of each open root.

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
/// Islands kept per open root: one for each pass of the archipelago (see `AppState::settle`).
const KEEP: usize = 2;

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
pub(super) fn step(free: u64) -> u64 {
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
    /// The directions its gates face, tenths of a degree: the island is built from these.
    neighbours: Vec<i32>,
}

/// A built island map: its key, the island and the encoded bytes.
type Built = (CityKey, Arc<city::Island>, Vec<u8>);

/// An island as the archipelago takes it: the rev of the tree it was built from (the one its
/// encoded map carries), the island and its encoded map.
pub(super) type Kept = (u64, Arc<city::Island>, Vec<u8>);

/// The archipelago last laid out: its members' `(generation, rev, used)`, then their islands
/// (in member order) and where they stand.
pub(super) type World = (Vec<(u64, u64, u64)>, Vec<Kept>, Vec<[f32; 2]>);

/// The island maps of every open root, by generation, the one last asked for last.
#[derive(Default)]
pub struct CityCache {
    kept: Mutex<HashMap<u64, Vec<Built>>>,
    /// Held while an archipelago is laid out, so that callers at once wait for it.
    pub(super) world: Mutex<Option<World>>,
    /// How many maps were built, for the tests.
    #[cfg(test)]
    pub builds: AtomicUsize,
}

impl CityCache {
    /// The island kept for `generation` under `key`, else what `build()` gives, stored; of a
    /// generation the last `KEEP` asked for are kept. Entries of generations not in `open` are
    /// dropped. Building takes no lock, so two calls with a new key may both build.
    fn get_or_build(
        &self,
        generation: u64,
        key: CityKey,
        open: &[u64],
        build: impl FnOnce() -> (Arc<city::Island>, Vec<u8>),
    ) -> (Arc<city::Island>, Vec<u8>) {
        let lock = || self.kept.lock().unwrap_or_else(|e| e.into_inner());
        {
            let mut kept = lock();
            kept.retain(|g, _| open.contains(g));
            if let Some(list) = kept.get_mut(&generation)
                && let Some(at) = list.iter().position(|(have, ..)| *have == key)
            {
                let hit = list.remove(at);
                let out = (hit.1.clone(), hit.2.clone());
                list.push(hit);
                return out;
            }
        }
        #[cfg(test)]
        self.builds
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let (island, bytes) = build();
        let mut kept = lock();
        let list = kept.entry(generation).or_default();
        list.retain(|(have, ..)| *have != key);
        list.push((key, island.clone(), bytes.clone()));
        if list.len() > KEEP {
            list.remove(0);
        }
        (island, bytes)
    }

    /// The island last asked for of `generation`, if it is still open, with the `rev` of the
    /// tree it was built from.
    #[cfg(test)]
    pub fn island(&self, generation: u64) -> Option<(u64, Arc<city::Island>)> {
        let kept = self.kept.lock().unwrap_or_else(|e| e.into_inner());
        (kept.get(&generation)?.last()).map(|(key, island, _)| (key.rev, island.clone()))
    }
}

/// Every mount point, and `(mount, free bytes)` of the disks that answer.
pub(super) fn survey(cache_dir: &Path) -> (Vec<String>, Vec<(String, u64)>) {
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
pub(super) fn members_of(
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
    /// The island of the root `generation` with `free` bytes, its gates facing `neighbours`
    /// (radians, rounded to 0.1° as its key holds them): the one in memory, else built.
    pub(super) fn island_in(
        &self,
        generation: u64,
        free: u64,
        neighbours: &[f32],
        open: &[u64],
    ) -> Result<Kept, CmdError> {
        let tenths: Vec<i32> = (neighbours.iter())
            .map(|a| (a.to_degrees() * 10.0).round() as i32)
            .collect();
        self.with_live(generation, 0, |tree| {
            let root = tree.name(0);
            let key = CityKey {
                rev: tree.rev,
                free,
                neighbours: tenths.clone(),
            };
            let (island, bytes) = self.0.city.get_or_build(generation, key, open, || {
                let input = city::IslandInput {
                    root: city::island_summary(tree, 0),
                    free,
                    neighbours: tenths
                        .iter()
                        .map(|&t| (t as f32 / 10.0).to_radians())
                        .collect(),
                    seed: fnv1a64(root.as_bytes()),
                };
                let island = city::island(&input);
                let bytes = city::encode_city(generation, tree.rev, tree.approximate, &island);
                (Arc::new(island), bytes)
            });
            (tree.rev, island, bytes)
        })
    }
}

#[cfg(test)]
#[path = "island_tests.rs"]
mod tests;
