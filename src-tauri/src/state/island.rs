//! The island of the open root: its input from the saved scans and the disks' free space, and
//! the last result kept in memory.

use std::path::Path;
use std::sync::Mutex;
#[cfg(test)]
use std::sync::atomic::AtomicUsize;

use sizeatlas_core::cache::{cache_path, fnv1a64, read_header};
use sizeatlas_core::city;
use sizeatlas_core::tree::VolumeUsage;

use super::AppState;
use crate::error::CmdError;
use crate::sources;

/// Islands in the world, the open one included.
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

/// The islands `(used, free)` and the place of the open one among them. The open root always
/// stands; of the saved `scans` (`(root, used)`) those inside it or around it are left out, of
/// two nested ones the outer stays, and the biggest fill the rest of [`MAX_ISLANDS`]. The order
/// is by size, so every island sees the same world whichever root is open.
pub fn islands(
    open_root: &str,
    open_used: u64,
    scans: &[(String, u64)],
    free_of: impl Fn(&str) -> u64,
) -> (Vec<(u64, u64)>, usize) {
    // (folders, root, used, is the open one)
    type Entry<'a> = (Vec<String>, &'a str, u64, bool);
    let open = parts(open_root);
    let mut others: Vec<Entry> = scans
        .iter()
        .map(|(root, used)| (parts(root), root.as_str(), *used, false))
        .filter(|(p, ..)| !p.starts_with(&open) && !open.starts_with(p))
        .collect();
    // Outer first: a nested scan then finds its outer one already kept.
    others.sort_by_key(|(p, ..)| p.len());
    let mut kept: Vec<Entry> = Vec::new();
    for scan in others {
        if !kept.iter().any(|(k, ..)| scan.0.starts_with(k)) {
            kept.push(scan);
        }
    }
    let by_size = |a: &Entry, b: &Entry| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0));
    kept.sort_by(by_size);
    kept.truncate(MAX_ISLANDS - 1);
    kept.push((open, open_root, open_used, true));
    kept.sort_by(by_size);
    let me = kept.iter().position(|e| e.3).unwrap_or(0);
    let list = kept
        .iter()
        .map(|&(_, root, used, _)| (used, free_of(root)))
        .collect();
    (list, me)
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
    generation: u64,
    rev: u64,
    islands: Vec<(u64, u64)>,
}

/// The last island map; one entry is enough, the panel shows one root.
#[derive(Default)]
pub struct CityCache {
    last: Mutex<Option<(CityKey, Vec<u8>)>>,
    /// How many maps were built, for the tests.
    #[cfg(test)]
    pub builds: AtomicUsize,
}

impl CityCache {
    /// The bytes kept for `key`, else `build()` stored under it. Building takes no lock, so two
    /// calls with a new key may both build.
    fn get_or_build(&self, key: CityKey, build: impl FnOnce() -> Vec<u8>) -> Vec<u8> {
        let lock = || self.last.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((kept, bytes)) = lock().as_ref()
            && *kept == key
        {
            return bytes.clone();
        }
        #[cfg(test)]
        self.builds
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let bytes = build();
        *lock() = Some((key, bytes.clone()));
        bytes
    }
}

impl AppState {
    /// Encoded island map of the whole root `generation` (see `sizeatlas_core::city`). The saved
    /// scans in `cache_dir` and the disks give the other islands and the free space.
    pub fn city(&self, generation: u64, cache_dir: &Path) -> Result<Vec<u8>, CmdError> {
        self.with_live(generation, 0, |tree| {
            let known = sources::list(cache_dir);
            let disks: Vec<(String, u64)> = known
                .disks
                .into_iter()
                .filter(|d| d.connected)
                .map(|d| (d.mount, d.available))
                .collect();
            let scans: Vec<(String, u64)> = known
                .scans
                .into_iter()
                .filter(|s| !s.outdated)
                .map(|s| (s.root, s.total))
                .collect();
            let root = tree.name(0);
            let free_of = |r: &str| {
                let cached = if r == root {
                    tree.volume
                } else {
                    read_header(&cache_path(cache_dir, Path::new(r)))
                        .ok()
                        .and_then(|h| h.volume)
                };
                free_space(r, &disks, cached)
            };
            let (mut islands, me) = islands(root, tree.node(0).size, &scans, free_of);
            for (_, free) in &mut islands {
                *free -= *free % FREE_STEP;
            }
            let neighbours = city::directions(&islands, me);
            let free = islands[me].1;
            let key = CityKey {
                generation,
                rev: tree.rev,
                islands,
            };
            self.0.city.get_or_build(key, || {
                let input = city::IslandInput {
                    root: city::summary(tree, 0, 3),
                    free,
                    neighbours,
                    seed: fnv1a64(root.as_bytes()),
                };
                city::encode_city(
                    generation,
                    tree.rev,
                    tree.approximate,
                    &city::island(&input),
                )
            })
        })
    }
}

#[cfg(test)]
#[path = "island_tests.rs"]
mod tests;
