//! Reading files for the duplicate search: the checked open, BLAKE3 of a prefix, of a tail and
//! of the whole file, and the check that a file did not change while it was read.

use std::fs::{self, File, Metadata};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::platform::{Identity, identity, is_cloud, open_for_hash};
use crate::scanner::mtime_of;

/// Bytes hashed first; a file this short is read once, its prefix is all of it.
pub const PREFIX: usize = 16 * 1024;
/// Bytes at the end hashed before the whole file, for files longer than [`TAIL_FROM`] (videos
/// and disk images share long headers).
pub const TAIL: usize = 16 * 1024;
pub const TAIL_FROM: u64 = 1 << 20;
/// One read of the whole-file hash.
pub const BUFFER: usize = 1 << 20;

pub type Hash = [u8; 32];

/// Why a file was not compared.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Skip {
    /// Its content is in the cloud: reading it would download it.
    Cloud,
    /// It is not what the scan saw (length, time), it changed while read, or it is gone.
    Changed,
    NoAccess,
    /// Not a regular file (a link, a folder), or reading it failed.
    Failed,
}

/// The length and modification time (ns since the epoch) of an open file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamp {
    pub len: u64,
    pub mtime: i64,
}

impl Stamp {
    fn of(meta: &Metadata) -> Stamp {
        Stamp {
            len: meta.len(),
            mtime: mtime_of(meta),
        }
    }
}

/// BLAKE3 of the first [`PREFIX`] bytes of a file of `len` bytes, and that same hash as the
/// hash of the whole file when the file is no longer than the prefix.
#[cfg_attr(not(test), expect(dead_code, reason = "the search pipeline calls it"))]
pub(crate) fn prefix(file: &mut File, len: u64) -> io::Result<(Hash, Option<Hash>)> {
    let mut buf = [0u8; PREFIX];
    let n = len.min(PREFIX as u64) as usize;
    file.seek(SeekFrom::Start(0))?;
    file.read_exact(&mut buf[..n])?;
    let hash = *blake3::hash(&buf[..n]).as_bytes();
    Ok((hash, (n as u64 == len).then_some(hash)))
}

/// BLAKE3 of the last [`TAIL`] bytes of a file of `len` bytes.
#[cfg_attr(not(test), expect(dead_code, reason = "the search pipeline calls it"))]
pub(crate) fn tail(file: &mut File, len: u64) -> io::Result<Hash> {
    let mut buf = [0u8; TAIL];
    let n = len.min(TAIL as u64);
    file.seek(SeekFrom::Start(len - n))?;
    file.read_exact(&mut buf[..n as usize])?;
    Ok(*blake3::hash(&buf[..n as usize]).as_bytes())
}

/// BLAKE3 of the whole file, read from its start in reads of [`BUFFER`]; `progress` gets the
/// bytes of each read. `None` when `cancel` is set before a read.
#[cfg_attr(not(test), expect(dead_code, reason = "the search pipeline calls it"))]
pub(crate) fn full(
    file: &mut File,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64),
) -> io::Result<Option<Hash>> {
    whole(file, &|| cancel.load(Ordering::Relaxed), progress)
}

fn whole(
    file: &mut File,
    stop: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(u64),
) -> io::Result<Option<Hash>> {
    file.seek(SeekFrom::Start(0))?;
    let mut buf = vec![0u8; BUFFER];
    let mut hasher = blake3::Hasher::new();
    loop {
        if stop() {
            return Ok(None);
        }
        let n = match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        hasher.update(&buf[..n]);
        progress(n as u64);
    }
    Ok(Some(*hasher.finalize().as_bytes()))
}

/// The open file still has the length and time it had when it was opened.
pub(crate) fn verify_after(file: &File, opened: Stamp) -> Result<(), Skip> {
    match file.metadata() {
        Ok(meta) if Stamp::of(&meta) == opened => Ok(()),
        Ok(_) => Err(Skip::Changed),
        Err(e) => Err(skip_of(&e)),
    }
}

/// Opens the file at `path` to hash it, if it is the regular file of `len` bytes and time
/// `mtime` that the scan saw, and its content is on this device (a cloud file is never opened).
pub fn open_checked(path: &Path, len: u64, mtime: i64) -> Result<(File, Identity, Stamp), Skip> {
    let meta = fs::symlink_metadata(path).map_err(|e| skip_of(&e))?;
    if !meta.file_type().is_file() {
        return Err(Skip::Failed);
    }
    if is_cloud(&meta) {
        return Err(Skip::Cloud);
    }
    let file = open_for_hash(path).map_err(|e| skip_of(&e))?;
    // The handle's own view: the path may have been replaced since the check above.
    let meta = file.metadata().map_err(|e| skip_of(&e))?;
    if !meta.is_file() {
        return Err(Skip::Failed);
    }
    if is_cloud(&meta) {
        return Err(Skip::Cloud);
    }
    let stamp = Stamp::of(&meta);
    if stamp.len != len || !same_time(mtime, stamp.mtime, path) {
        return Err(Skip::Changed);
    }
    let identity = identity(&file);
    Ok((file, identity, stamp))
}

/// The whole-file hash of the file at `path`, checked as [`open_checked`] does before and as
/// `verify_after` does after reading; no size limit. `stop` is asked before every read: a stop
/// gives `Err(Skip::Failed)`, which the caller tells apart by its own `stop`.
pub fn rehash(
    path: &Path,
    len: u64,
    mtime: i64,
    stop: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(u64),
) -> Result<(Hash, Identity), Skip> {
    let (mut file, identity, stamp) = open_checked(path, len, mtime)?;
    let hash = whole(&mut file, stop, progress).map_err(|e| skip_of(&e))?;
    let hash = hash.ok_or(Skip::Failed)?;
    verify_after(&file, stamp)?;
    Ok((hash, identity))
}

/// Windows `ERROR_SHARING_VIOLATION` and `ERROR_LOCK_VIOLATION`: another program holds the file.
#[cfg(windows)]
const LOCKED: &[i32] = &[32, 33];
#[cfg(not(windows))]
const LOCKED: &[i32] = &[];

fn skip_of(e: &io::Error) -> Skip {
    match e.kind() {
        io::ErrorKind::NotFound => Skip::Changed,
        io::ErrorKind::PermissionDenied => Skip::NoAccess,
        _ if e.raw_os_error().is_some_and(|code| LOCKED.contains(&code)) => Skip::NoAccess,
        _ => Skip::Failed,
    }
}

/// Whether the `stored` time of the file at `path` is its `own` time or, on Windows and only if
/// that differs, the time of its entry in its folder's listing: there the scan takes it from the
/// listing, which can lag behind the file's own. Elsewhere the two are the same.
// ponytail: the rule of `recycle::disk::{unchanged, listed_mtime}` in the app, kept apart (two
// lines); the app may import this one once core exposes it.
fn same_time(stored: i64, own: i64, path: &Path) -> bool {
    own == stored || (cfg!(windows) && listed_mtime(path) == Some(stored))
}

fn listed_mtime(path: &Path) -> Option<i64> {
    let (folder, name) = (path.parent()?, path.file_name()?);
    let entry = fs::read_dir(folder)
        .ok()?
        .flatten()
        .find(|e| e.file_name() == name)?;
    entry.metadata().ok().map(|meta| mtime_of(&meta))
}
