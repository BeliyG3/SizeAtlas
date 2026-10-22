//! On-disk cache of one scan:
//! `"SZAT" | u32 version | u32 header length | postcard(header) | zstd(postcard(tree))`,
//! integers little-endian. The header is uncompressed so a list of scans can be shown
//! without decoding trees.
//! Every format version starts its header with the scan root, so a cache written by another version still tells which scan it was.

use std::fmt;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::thread::sleep;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::tree::{SizeMode, Tree, VolumeUsage};

const MAGIC: &[u8; 4] = b"SZAT";
pub const FORMAT_VERSION: u32 = 3;
const PREFIX_LEN: usize = 12;
/// Real headers are ~100 bytes; anything larger is a corrupt or foreign file.
const MAX_HEADER_LEN: usize = 64 * 1024;
const ZSTD_LEVEL: i32 = 3;
/// Antivirus scanners briefly lock freshly written files on Windows.
const RENAME_ATTEMPTS: u32 = 5;
const RENAME_RETRY_DELAY: Duration = Duration::from_millis(100);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CacheHeader {
    /// Must stay the first field in every format version (see the module docs).
    pub root: String,
    pub scanned_at: i64,
    pub total: u64,
    pub files: u64,
    pub approximate: bool,
    pub cluster: u64,
    pub size_mode: SizeMode,
    pub access_errors: u32,
    pub volume: Option<VolumeUsage>,
}

impl CacheHeader {
    pub fn of(tree: &Tree) -> CacheHeader {
        let root = tree.node(0);
        CacheHeader {
            root: tree.name(0).to_owned(),
            scanned_at: tree.scanned_at,
            total: root.size,
            files: u64::from(root.files),
            approximate: tree.approximate,
            cluster: tree.cluster,
            size_mode: tree.size_mode,
            access_errors: tree.access_errors,
            volume: tree.volume,
        }
    }
}

#[derive(Debug)]
pub enum CacheError {
    Io(io::Error),
    /// The file is not a readable cache of this format version.
    Invalid(&'static str),
    /// Written by another format version; only its scan root could be read.
    Outdated {
        root: String,
    },
}

impl fmt::Display for CacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CacheError::Io(e) => write!(f, "cache I/O error: {e}"),
            CacheError::Invalid(why) => write!(f, "invalid cache file: {why}"),
            CacheError::Outdated { root } => write!(
                f,
                "the cache of {root} was written by another format version"
            ),
        }
    }
}

impl std::error::Error for CacheError {}

impl From<io::Error> for CacheError {
    fn from(e: io::Error) -> Self {
        CacheError::Io(e)
    }
}

/// 64-bit FNV-1a. Stable across Rust versions, unlike `DefaultHasher`.
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &b| {
        (hash ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// Cache file of an already canonicalized scan root.
pub fn cache_path(cache_dir: &Path, canonical_root: &Path) -> PathBuf {
    let key = fnv1a64(canonical_root.to_string_lossy().as_bytes());
    cache_dir.join(format!("{key:016x}.bin"))
}

/// Writes the tree as it is, atomically (temporary file, then rename). Dead nodes are written too:
/// a change compacts the tree once they outnumber the live ones, so the file grows at most ×2,
/// and no copy of the tree is made.
pub fn save(tree: &Tree, path: &Path) -> Result<(), CacheError> {
    let tmp = tmp_path(path);
    fs::write(&tmp, encode(tree)?)?;
    rename_with_retry(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })?;
    Ok(())
}

/// The temporary file of `path`: the full name plus `.tmp`, so `x.bin` and `x.full` never share one.
fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".tmp");
    PathBuf::from(name)
}

fn encode(tree: &Tree) -> Result<Vec<u8>, CacheError> {
    let header_bytes = postcard::to_stdvec(&CacheHeader::of(tree))
        .map_err(|_| CacheError::Invalid("header encoding"))?;
    let mut out = Vec::with_capacity(PREFIX_LEN + header_bytes.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(&(header_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(&header_bytes);
    let mut encoder = zstd::Encoder::new(out, ZSTD_LEVEL)?;
    postcard::to_io(tree, &mut encoder).map_err(|_| CacheError::Invalid("tree encoding"))?;
    Ok(encoder.finish()?)
}

fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    for _ in 1..RENAME_ATTEMPTS {
        if fs::rename(from, to).is_ok() {
            return Ok(());
        }
        sleep(RENAME_RETRY_DELAY);
    }
    fs::rename(from, to)
}

/// A file that ends early is `Invalid`; any other read failure stays an I/O error.
fn read_or_invalid(file: &mut File, buf: &mut [u8], what: &'static str) -> Result<(), CacheError> {
    file.read_exact(buf).map_err(|e| match e.kind() {
        io::ErrorKind::UnexpectedEof => CacheError::Invalid(what),
        _ => CacheError::Io(e),
    })
}

/// Reads only the uncompressed header.
pub fn read_header(path: &Path) -> Result<CacheHeader, CacheError> {
    let mut file = File::open(path)?;
    let mut prefix = [0u8; PREFIX_LEN];
    read_or_invalid(&mut file, &mut prefix, "truncated prefix")?;
    let (version, header_len) = check_prefix(&prefix)?;
    let mut header = vec![0u8; header_len];
    read_or_invalid(&mut file, &mut header, "truncated header")?;
    decode_header(version, &header)
}

/// Reads and validates a whole cache file.
pub fn load(path: &Path) -> Result<(CacheHeader, Tree), CacheError> {
    let bytes = fs::read(path)?;
    let prefix: &[u8; PREFIX_LEN] = bytes
        .get(..PREFIX_LEN)
        .and_then(|p| p.try_into().ok())
        .ok_or(CacheError::Invalid("truncated prefix"))?;
    let (version, header_len) = check_prefix(prefix)?;
    let header_end = PREFIX_LEN + header_len;
    let header_bytes = bytes
        .get(PREFIX_LEN..header_end)
        .ok_or(CacheError::Invalid("truncated header"))?;
    let header = decode_header(version, header_bytes)?;
    let body = zstd::decode_all(&bytes[header_end..])
        .map_err(|_| CacheError::Invalid("body decompression"))?;
    let tree: Tree =
        postcard::from_bytes(&body).map_err(|_| CacheError::Invalid("tree decoding"))?;
    tree.check_structure().map_err(CacheError::Invalid)?;
    Ok((header, tree))
}

/// Checks the magic and the header length; returns the format version and the header length.
fn check_prefix(prefix: &[u8; PREFIX_LEN]) -> Result<(u32, usize), CacheError> {
    if &prefix[..4] != MAGIC {
        return Err(CacheError::Invalid("not a SizeAtlas cache"));
    }
    let version = u32::from_le_bytes(prefix[4..8].try_into().expect("4 bytes"));
    let header_len = u32::from_le_bytes(prefix[8..12].try_into().expect("4 bytes")) as usize;
    if header_len > MAX_HEADER_LEN {
        return Err(CacheError::Invalid("header too large"));
    }
    Ok((version, header_len))
}

/// Decodes a header; for another format version, reports only its root.
fn decode_header(version: u32, bytes: &[u8]) -> Result<CacheHeader, CacheError> {
    if version == FORMAT_VERSION {
        return postcard::from_bytes(bytes).map_err(|_| CacheError::Invalid("header decoding"));
    }
    match postcard::take_from_bytes::<String>(bytes) {
        Ok((root, _)) => Err(CacheError::Outdated { root }),
        Err(_) => Err(CacheError::Invalid("other format version")),
    }
}

mod files;
pub use files::{ScanFiles, remove_all, save_full_scan, scan_files};

#[cfg(test)]
mod files_tests;
#[cfg(test)]
mod tests;
