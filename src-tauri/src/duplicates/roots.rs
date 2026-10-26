//! The roots a duplicate search takes: every open root but those being scanned, each with the
//! volume its trash requests queue on and the kind of disk it lies on.

use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(test)]
use std::sync::atomic::Ordering;

use sizeatlas_core::duplicates::DiskKind;
use sizeatlas_core::duplicates::results::RootMark;
use sizeatlas_core::tree::Tree;
use sizeatlas_core::tree::flags::SCANNING;
use sysinfo::{DiskRefreshKind, Disks};

use crate::state::AppState;

/// An open root to search, as it was when picked.
pub(crate) struct Picked {
    pub tree: Arc<Tree>,
    pub root: String,
    pub generation: u64,
    /// The key of the trash queue of its volume (`AppState::volume_of`).
    pub volume: String,
    pub disk: DiskKind,
}

/// The open roots a search takes now, as marks, and the paths of those it skips: a root being
/// scanned for the first time, or rescanned (its tree is about to be replaced).
pub(crate) fn current(state: &AppState) -> (Vec<RootMark>, Vec<String>) {
    // The queue before the data, as everywhere; the trees are let go at once.
    let scans = state.scans();
    let (mut taken, mut skipped) = (Vec::new(), Vec::new());
    for (generation, tree) in state.open_trees() {
        let path = tree.name(0).to_owned();
        if tree.node(0).has(SCANNING) || scans.running_full_scan(&path) {
            skipped.push(path);
        } else {
            taken.push(RootMark {
                path,
                generation,
                rev: tree.rev,
            });
        }
    }
    (taken, skipped)
}

/// The roots a search takes now, with their trees, and the paths of those it skips (see
/// [`current`]). Asking the volume of a network share the first time may take a while, and so
/// may the context the first time: call it off the async runtime. The disks are listed only
/// with `disks` (a search; an estimate needs no disk kind, and listing them asks every volume of
/// the machine); otherwise every disk is `Unknown`. The trees are taken last, in one read, so
/// none is held across a question or a second read.
pub(crate) fn pick(state: &AppState, disks: bool) -> (Vec<Picked>, Vec<String>) {
    let (roots, skipped) = current(state);
    if let Some(first) = roots.first() {
        state.duplicates_env(&first.path);
    }
    let mounts = if disks { mounts(state) } else { Vec::new() };
    let placed: Vec<(String, String, DiskKind)> = roots
        .into_iter()
        .map(|m| {
            let volume = state.volume_of(&m.path);
            let disk = disk_of(Path::new(&m.path), &mounts);
            (m.path, volume, disk)
        })
        .collect();
    let mut trees = state.open_trees();
    let picked = placed
        .into_iter()
        .filter_map(|(root, volume, disk)| {
            // A root closed meanwhile is left out; the result then is stale at once.
            let at = trees.iter().position(|(_, t)| t.name(0) == root)?;
            let (generation, tree) = trees.swap_remove(at);
            Some(Picked {
                tree,
                root,
                generation,
                volume,
                disk,
            })
        })
        .collect();
    (picked, skipped)
}

/// The kind of the disk mounted at the longest mount point that holds `root`, compared by
/// path components; `Unknown` when none does.
pub(crate) fn disk_of(root: &Path, mounts: &[(PathBuf, DiskKind)]) -> DiskKind {
    mounts
        .iter()
        .filter(|(at, _)| root.starts_with(at))
        .max_by_key(|(at, _)| at.components().count())
        .map_or(DiskKind::Unknown, |&(_, kind)| kind)
}

/// The mount points of this machine and the kind of disk of each; nothing else is asked.
fn mounts(
    #[cfg_attr(
        not(test),
        expect(unused_variables, reason = "only the tests count the reads")
    )]
    state: &AppState,
) -> Vec<(PathBuf, DiskKind)> {
    #[cfg(test)]
    state
        .0
        .duplicates
        .mounts_read
        .fetch_add(1, Ordering::SeqCst);
    Disks::new_with_refreshed_list_specifics(DiskRefreshKind::nothing().with_kind())
        .list()
        .iter()
        .map(|d| {
            let kind = match d.kind() {
                sysinfo::DiskKind::SSD => DiskKind::Ssd,
                sysinfo::DiskKind::HDD => DiskKind::Hdd,
                sysinfo::DiskKind::Unknown(_) => DiskKind::Unknown,
            };
            (d.mount_point().to_path_buf(), kind)
        })
        .collect()
}
