//! What the start screen offers: mounted disks and saved scans.

use std::cmp::Reverse;
use std::fs;
use std::path::Path;

use sizeatlas_core::cache::{CacheError, read_header};
use sizeatlas_core::tree::VolumeUsage;
use sysinfo::Disks;

use crate::dto::{CachedScanDto, DiskDto, SourcesDto};

#[cfg(windows)]
mod network;

/// Pseudo file systems that never hold user data.
const SKIPPED_FS: &[&str] = &[
    "tmpfs",
    "devtmpfs",
    "devfs",
    "squashfs",
    "overlay",
    "ramfs",
    "proc",
    "sysfs",
    "autofs",
    "cgroup",
    "cgroup2",
    "debugfs",
    "tracefs",
    "securityfs",
    "efivarfs",
    "pstore",
    "bpf",
    "configfs",
    "fusectl",
    "mqueue",
    "hugetlbfs",
    "binfmt_misc",
    "nsfs",
];

pub fn list(cache_dir: &Path) -> SourcesDto {
    SourcesDto {
        disks: disks(),
        scans: cached_scans(cache_dir),
    }
}

/// Size and used space of the volume mounted exactly at `root`; `None` for any other folder.
pub fn volume_usage(root: &Path) -> Option<VolumeUsage> {
    Disks::new_with_refreshed_list()
        .list()
        .iter()
        .find(|d| d.mount_point() == root)
        .map(|d| VolumeUsage {
            total: d.total_space(),
            used: d.total_space().saturating_sub(d.available_space()),
        })
}

fn disks() -> Vec<DiskDto> {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut disks = local_disks();
    #[cfg(windows)]
    disks.extend(network::list());
    disks
}

fn local_disks() -> Vec<DiskDto> {
    Disks::new_with_refreshed_list()
        .list()
        .iter()
        .filter(|d| !SKIPPED_FS.contains(&d.file_system().to_string_lossy().as_ref()))
        // macOS lists the system's own volumes; `/` already covers the Data volume.
        .filter(|d| !d.mount_point().starts_with("/System/Volumes"))
        .filter(|d| d.total_space() > 0)
        .map(|d| DiskDto {
            name: d.name().to_string_lossy().into_owned(),
            mount: d.mount_point().display().to_string(),
            total: d.total_space(),
            available: d.available_space(),
            removable: d.is_removable(),
            network: false,
            connected: true,
        })
        .collect()
}

/// Saved scans, newest first; scans of another format version come last, marked `outdated`.
/// Unreadable files are skipped.
pub fn cached_scans(cache_dir: &Path) -> Vec<CachedScanDto> {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return Vec::new();
    };
    let mut scans: Vec<CachedScanDto> = entries
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "bin"))
        .filter_map(|e| match read_header(&e.path()) {
            Ok(h) => Some(CachedScanDto {
                root: h.root,
                scanned_at: h.scanned_at,
                total: h.total,
                files: h.files,
                outdated: false,
            }),
            Err(CacheError::Outdated { root }) => Some(CachedScanDto {
                root,
                scanned_at: 0,
                total: 0,
                files: 0,
                outdated: true,
            }),
            Err(_) => None,
        })
        .collect();
    scans.sort_by(|a, b| {
        (a.outdated, Reverse(a.scanned_at), &a.root).cmp(&(
            b.outdated,
            Reverse(b.scanned_at),
            &b.root,
        ))
    });
    scans
}
