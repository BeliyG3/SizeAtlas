//! Details of one file or folder that a scan does not keep: creation and access times,
//! attributes and owner. Read on demand, only for the rows the UI shows.

use std::fs;
use std::io;
use std::path::Path;

use crate::scanner::epoch_nanos;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Details {
    /// Nanoseconds since the Unix epoch; `None` where the file system does not keep it.
    pub created: Option<i64>,
    pub accessed: Option<i64>,
    /// Windows: letters of the set attributes in the order `DRHSACEIOPL`; Unix: `drwxr-xr-x`.
    pub attributes: String,
    /// Windows: `DOMAIN\name` (the SID string for unknown accounts); Unix: user name or uid.
    /// `None` when the owner cannot be read.
    pub owner: Option<String>,
}

/// Reads the details of `path` itself; links are not followed.
pub fn read(path: &Path) -> io::Result<Details> {
    let meta = fs::symlink_metadata(path)?;
    Ok(Details {
        created: meta.created().ok().map(epoch_nanos),
        accessed: meta.accessed().ok().map(epoch_nanos),
        attributes: sys::attributes(&meta),
        owner: sys::owner(path, &meta),
    })
}

#[cfg(unix)]
mod unix;
#[cfg(unix)]
use unix as sys;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as sys;

#[cfg(test)]
mod tests;
