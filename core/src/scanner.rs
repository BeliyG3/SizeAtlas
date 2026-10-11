//! Parallel directory walker. Every directory is one rayon task that sends exactly
//! one [`DirRec`]; the records are then laid out by [`Tree::from_records`].

use std::ffi::OsString;
use std::fs::{self, Metadata};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::platform::{self, Volume};
use crate::tree::{DirRec, FileRec, NO_PARENT, ScanMeta, Tree, flags};

/// Live counters for a progress display. `current` is updated best-effort.
#[derive(Default)]
pub struct Progress {
    pub files: AtomicU64,
    pub dirs: AtomicU64,
    pub bytes: AtomicU64,
    pub current: Mutex<String>,
}

pub enum ScanOutcome {
    Done(Tree),
    Cancelled,
}

struct Ctx<'a> {
    tx: Sender<DirRec>,
    next_id: AtomicU32,
    cancel: &'a AtomicBool,
    progress: &'a Progress,
    volume: Volume,
}

struct DirTask {
    path: PathBuf,
    id: u32,
    parent: u32,
    name: OsString,
    mtime: i64,
    flags: u8,
}

/// Scans `root` (made canonical first) using all CPU cores.
pub fn scan(root: &Path, cancel: &AtomicBool, progress: &Progress) -> io::Result<ScanOutcome> {
    let root = dunce::canonicalize(root)?;
    let meta = fs::symlink_metadata(&root)?;
    if !meta.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "scan root is not a directory",
        ));
    }
    let volume = Volume::of(&root, &meta);
    let (records, scan_meta) = walk_all(root, &meta, volume, cancel, progress);
    if cancel.load(Ordering::Relaxed) {
        return Ok(ScanOutcome::Cancelled);
    }
    Ok(ScanOutcome::Done(Tree::from_records(records, scan_meta)))
}

/// What a scan of one folder found (see [`scan_folder`]).
pub enum FolderScan {
    /// Records of the folder (record 0) and everything below it, for `Tree::replace_subtree`.
    Done(Vec<DirRec>),
    /// The folder is not there any more, or is no longer a folder.
    Gone,
    Cancelled,
}

/// Scans `folder`, a folder inside the scan root `root`, with the rules of `root`'s volume: the
/// devices a Unix scan may enter, the cluster size on Windows. `folder` comes from the tree and
/// is not made canonical.
pub fn scan_folder(
    folder: &Path,
    root: &Path,
    cancel: &AtomicBool,
    progress: &Progress,
) -> io::Result<FolderScan> {
    let root_meta = fs::symlink_metadata(root)?;
    let meta = match fs::symlink_metadata(folder) {
        Ok(meta) if meta.is_dir() => meta,
        Ok(_) => return Ok(FolderScan::Gone),
        // NotADirectory: a file took the place of a folder on the way.
        Err(e)
            if matches!(
                e.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
            ) =>
        {
            return Ok(FolderScan::Gone);
        }
        Err(e) => return Err(e),
    };
    let volume = Volume::of(root, &root_meta);
    let (records, _) = walk_all(folder.to_path_buf(), &meta, volume, cancel, progress);
    if cancel.load(Ordering::Relaxed) {
        return Ok(FolderScan::Cancelled);
    }
    Ok(FolderScan::Done(records))
}

/// Walks `path` and everything below it; `path` is record 0, with its full path as name.
fn walk_all(
    path: PathBuf,
    meta: &Metadata,
    volume: Volume,
    cancel: &AtomicBool,
    progress: &Progress,
) -> (Vec<DirRec>, ScanMeta) {
    #[cfg(target_os = "macos")]
    platform::forbid_cloud_downloads();
    let (tx, rx) = mpsc::channel();
    let ctx = Ctx {
        tx,
        next_id: AtomicU32::new(1),
        cancel,
        progress,
        volume,
    };
    let root_task = DirTask {
        name: path.clone().into_os_string(),
        path,
        id: 0,
        parent: NO_PARENT,
        mtime: mtime_of(meta),
        flags: flags::IS_DIR | platform::dir_flags(meta),
    };
    rayon::scope(|s| walk(s, &ctx, root_task));
    let scan_meta = ScanMeta {
        cluster: ctx.volume.cluster,
        size_mode: ctx.volume.size_mode(),
        scanned_at: now_secs(),
    };
    drop(ctx); // closes the channel
    (rx.into_iter().collect(), scan_meta)
}

fn walk<'s>(s: &rayon::Scope<'s>, ctx: &'s Ctx<'_>, task: DirTask) {
    let mut dir_flags = task.flags;
    let mut files = Vec::new();
    if dir_flags & flags::CLOUD == 0 && !ctx.cancel.load(Ordering::Relaxed) {
        match fs::read_dir(&task.path) {
            Ok(entries) => {
                for entry in entries {
                    let Ok(entry) = entry else {
                        dir_flags |= flags::ACCESS_ERROR;
                        continue;
                    };
                    let Ok(file_type) = entry.file_type() else {
                        dir_flags |= flags::ACCESS_ERROR;
                        continue;
                    };
                    if file_type.is_symlink() {
                        continue;
                    }
                    let meta = match entry.metadata() {
                        Ok(meta) => meta,
                        // Deleted while we were listing the folder: not an access problem.
                        Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                        Err(_) => {
                            dir_flags |= flags::ACCESS_ERROR;
                            continue;
                        }
                    };
                    if file_type.is_dir() {
                        let path = entry.path();
                        if !ctx.volume.allows_dir(&path, &meta) {
                            continue;
                        }
                        let child = DirTask {
                            path,
                            id: ctx.next_id.fetch_add(1, Ordering::Relaxed),
                            parent: task.id,
                            name: entry.file_name(),
                            mtime: mtime_of(&meta),
                            flags: flags::IS_DIR | platform::dir_flags(&meta),
                        };
                        s.spawn(move |s| walk(s, ctx, child));
                    } else {
                        let size = ctx.volume.disk_size(&meta, || entry.path());
                        ctx.progress.files.fetch_add(1, Ordering::Relaxed);
                        ctx.progress.bytes.fetch_add(size, Ordering::Relaxed);
                        files.push(FileRec {
                            name: entry.file_name(),
                            size,
                            len: meta.len(),
                            mtime: mtime_of(&meta),
                            flags: 0,
                            ino: platform::hardlink_key(&meta),
                        });
                    }
                }
            }
            // Includes permission denied and paths too long for the OS.
            Err(_) => dir_flags |= flags::ACCESS_ERROR,
        }
    }
    ctx.progress.dirs.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut current) = ctx.progress.current.try_lock() {
        *current = task.path.display().to_string();
    }
    let record = DirRec {
        id: task.id,
        parent: task.parent,
        name: task.name,
        mtime: task.mtime,
        flags: dir_flags,
        files,
    };
    // The receiver outlives the scan, so sending cannot fail.
    let _ = ctx.tx.send(record);
}

/// Modification time in nanoseconds since the Unix epoch (negative before it, 0 if unknown).
pub fn mtime_of(meta: &Metadata) -> i64 {
    meta.modified().map_or(0, epoch_nanos)
}

/// Nanoseconds since the Unix epoch; negative before it.
pub fn epoch_nanos(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_nanos() as i64,
        Err(before) => -(before.duration().as_nanos() as i64),
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests;
