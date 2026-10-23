//! The re-check right before a row is deleted: a fresh walk of the item on disk that refuses what
//! the list would not offer now, however stale the tree is. Types and times come only from the
//! item's own metadata; nothing is taken from the scan.

use std::fs::{self, Metadata};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::markers::WORK_NAMES;
use super::paths::fits;
use super::rules::BYTECODE;
use super::{Guard, Reason};
use crate::platform::{Reparse, change_time, device, is_cloud, is_foreign, reparse, volume_mount};

/// A Temp item must be older than this by all three of its times.
const TEMP_AGE_NS: i64 = 7 * 86_400 * 1_000_000_000;
/// `stop` is asked before each folder and after this many entries.
const STOP_EVERY: u32 = 1000;

/// Why a row is not deleted.
#[derive(Debug)]
pub enum Refusal {
    /// Never touched: a never place or name ([`Guard`]), cloud content, a reparse point that is
    /// no link, a mount point, a work marker in an old Temp item, or on Unix another user's
    /// item, a socket, FIFO or device.
    Protected,
    /// No longer what was listed: the item or a folder above it is a link now, its content no
    /// longer fits its rule, or a Temp item is younger than 7 days by one of its times, or one of
    /// them is unknown.
    Changed,
    /// The item, a folder above it, an entry or a time could not be read.
    NoAccess(PathBuf, io::Error),
    /// `stop` returned true.
    Stopped,
}

/// Walks the row `path` listed for `reason` once more, without recursion, and refuses it if
/// anything in it is protected, changed, linked or unreadable. Links inside (symbolic links,
/// junctions, mount points) are leaves: never entered, never followed, as deleting the row
/// removes only the link; other reparse points are refused. `guard` holds the never places of
/// the list; `now_ns` is ns since the epoch; `stop` is asked before each folder and every
/// [`STOP_EVERY`] entries.
pub fn recheck(
    path: &Path,
    reason: Reason,
    guard: &Guard,
    now_ns: i64,
    stop: &dyn Fn() -> bool,
) -> Result<(), Refusal> {
    let meta = fs::symlink_metadata(path).map_err(|e| denied(path, e))?;
    if reparse(&meta, path) != Reparse::Plain {
        return Err(Refusal::Changed);
    }
    no_link_above(path)?;
    let trail = guard
        .start(&path.to_string_lossy())
        .ok_or(Refusal::Protected)?;
    let check = Check {
        reason,
        now_ns,
        device: device(&meta),
    };
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    check.entry(path, &name, &meta, true)?;
    if !meta.is_dir() {
        return Ok(());
    }
    let mut stack = vec![(path.to_owned(), trail)];
    let mut seen = 0u32;
    while let Some((dir, trail)) = stack.pop() {
        if stop() {
            return Err(Refusal::Stopped);
        }
        for entry in fs::read_dir(&dir).map_err(|e| denied(&dir, e))? {
            seen = seen.wrapping_add(1);
            if seen.is_multiple_of(STOP_EVERY) && stop() {
                return Err(Refusal::Stopped);
            }
            let entry = entry.map_err(|e| denied(&dir, e))?;
            let path = entry.path();
            // Not followed: `DirEntry::metadata` describes the entry itself, link or not.
            let meta = entry.metadata().map_err(|e| denied(&path, e))?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let trail = guard.enter(&trail, &name).ok_or(Refusal::Protected)?;
            let enter = enters(reparse(&meta, &path), meta.is_dir())?;
            check.entry(&path, &name, &meta, false)?;
            if enter {
                stack.push((path, trail));
            }
        }
    }
    Ok(())
}

/// The folders above `path`, up to the mount point of its volume, are no reparse points: a
/// folder replaced by a junction after the scan would move the row somewhere the guard cannot
/// see by its path.
fn no_link_above(path: &Path) -> Result<(), Refusal> {
    let mount = volume_mount(path);
    for above in path.ancestors().skip(1) {
        if above.as_os_str().is_empty() || mount.as_deref() == Some(above) {
            break;
        }
        let meta = fs::symlink_metadata(above).map_err(|e| denied(above, e))?;
        if reparse(&meta, above) != Reparse::Plain {
            return Err(Refusal::Changed);
        }
    }
    Ok(())
}

/// Whether the walk enters an entry of this kind: only plain folders. A link is a leaf; a
/// reparse point that is no link is refused.
pub(super) fn enters(kind: Reparse, is_dir: bool) -> Result<bool, Refusal> {
    match kind {
        Reparse::Plain => Ok(is_dir),
        Reparse::Link => Ok(false),
        Reparse::Other => Err(Refusal::Protected),
    }
}

fn denied(path: &Path, error: io::Error) -> Refusal {
    Refusal::NoAccess(path.to_owned(), error)
}

/// A time as ns since the epoch; none, or one at or before the epoch (a cleared FILETIME reads
/// as 1601), is unknown: 0.
fn known_ns(time: io::Result<SystemTime>) -> i64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| i64::try_from(d.as_nanos()).ok())
        .unwrap_or(0)
}

/// The checks of one entry besides the guard and its kind of reparse point.
struct Check {
    reason: Reason,
    now_ns: i64,
    /// The device of the row: an entry on another one is a mount point.
    device: u64,
}

impl Check {
    /// `top`: the row itself.
    fn entry(&self, path: &Path, name: &str, meta: &Metadata, top: bool) -> Result<(), Refusal> {
        if is_cloud(meta) || is_foreign(meta) || device(meta) != self.device {
            return Err(Refusal::Protected);
        }
        match self.reason {
            Reason::PythonBytecode => {
                let fits_rule = if top {
                    meta.is_dir()
                } else {
                    meta.is_file() && BYTECODE.iter().any(|m| fits(m, name, cfg!(windows)))
                };
                if !fits_rule {
                    return Err(Refusal::Changed);
                }
            }
            // TempWork and TempLarge rows are in "Check before deleting" with their markers.
            Reason::TempOld if WORK_NAMES.has(&name.to_ascii_lowercase()) => {
                return Err(Refusal::Protected);
            }
            _ => {}
        }
        if matches!(
            self.reason,
            Reason::TempOld | Reason::TempLarge | Reason::TempWork
        ) {
            // Unpacking keeps old modification times; creation and change times are new. An
            // unknown time (0) may be a new one.
            let changed = change_time(path).map_err(|e| denied(path, e))?;
            // A file system without creation times (some on Linux) loses nothing: there the
            // change time is never older than the creation.
            let created = match meta.created() {
                Err(e) if e.kind() == io::ErrorKind::Unsupported => changed,
                t => known_ns(t),
            };
            let times = [known_ns(meta.modified()), created, changed];
            let young = |&t: &i64| t == 0 || self.now_ns.saturating_sub(t) <= TEMP_AGE_NS;
            if times.iter().any(young) {
                return Err(Refusal::Changed);
            }
        }
        Ok(())
    }
}
