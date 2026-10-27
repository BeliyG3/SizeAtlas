//! Hashes of files read before, kept in memory so that another search does not read the files
//! that did not change.

use std::collections::HashMap;

use super::hash::Hash;
use crate::platform::FileId;

/// The hashes known of one file.
#[derive(Clone, Copy)]
pub(crate) struct Hashes {
    pub prefix: Option<Hash>,
    pub full: Option<Hash>,
}

struct Entry {
    len: u64,
    mtime: i64,
    hashes: Hashes,
}

/// Hashes by volume key and file id, valid for the length and time they were read at. A file
/// of unknown time (0) is never cached: a rewrite of the same length would go unseen.
// ponytail: never evicts, about 150 B per file read for the whole session (a million files keep
// about 150 MB); add an LRU or a clear on close of the mode if that ever matters.
#[derive(Default)]
pub struct HashCache {
    volumes: HashMap<String, HashMap<FileId, Entry>>,
}

impl HashCache {
    /// What is known of the file `id` of `volume`, if it still has `len` and `mtime`.
    pub(crate) fn get(&self, volume: &str, id: FileId, len: u64, mtime: i64) -> Option<Hashes> {
        let e = self.volumes.get(volume)?.get(&id)?;
        (mtime != 0 && e.len == len && e.mtime == mtime).then_some(e.hashes)
    }

    pub(crate) fn put_prefix(&mut self, volume: &str, id: FileId, len: u64, mtime: i64, h: Hash) {
        if let Some(hashes) = self.entry(volume, id, len, mtime) {
            hashes.prefix = Some(h);
        }
    }

    pub(crate) fn put_full(&mut self, volume: &str, id: FileId, len: u64, mtime: i64, h: Hash) {
        if let Some(hashes) = self.entry(volume, id, len, mtime) {
            hashes.full = Some(h);
        }
    }

    /// The hashes of the file at `len` and `mtime`, emptied when it had another length or time.
    fn entry(&mut self, volume: &str, id: FileId, len: u64, mtime: i64) -> Option<&mut Hashes> {
        if mtime == 0 {
            return None;
        }
        if !self.volumes.contains_key(volume) {
            self.volumes.insert(volume.to_owned(), HashMap::new());
        }
        let files = self.volumes.get_mut(volume)?;
        let fresh = || Entry {
            len,
            mtime,
            hashes: Hashes {
                prefix: None,
                full: None,
            },
        };
        let e = files.entry(id).or_insert_with(fresh);
        if (e.len, e.mtime) != (len, mtime) {
            *e = fresh();
        }
        Some(&mut e.hashes)
    }
}

impl HashCache {
    /// Files with known hashes.
    pub fn len(&self) -> usize {
        self.volumes.values().map(HashMap::len).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
