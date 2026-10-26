//! Reading one file in a step: opened again and checked to be the file first seen, its hashes
//! taken from the cache when it knows them, else read and checked to be unchanged after the
//! read; only then cached.

use std::fs::File;

use super::{Item, Search, lock};
use crate::duplicates::cache::Hashes;
use crate::duplicates::hash::{self, Hash, Skip, Stamp, open_checked, skip_of, verify_after};

impl Search<'_> {
    /// The prefix hash of `item`, and its whole-file hash when the prefix is all of it.
    pub(super) fn prefix(&self, item: &Item) -> Result<(Hash, Option<Hash>), Skip> {
        let (mut file, stamp) = self.reopen(item)?;
        let known = self.cached(item, stamp);
        if let Some(prefix) = known.prefix {
            return Ok((prefix, known.full));
        }
        lock(&self.stats).prefix_reads += 1;
        let (prefix, full) = hash::prefix(&mut file, stamp.len).map_err(|e| skip_of(&e))?;
        self.checked(&file, stamp, item)?;
        self.remember(item, stamp, Some(prefix), full);
        Ok((prefix, full))
    }

    /// The tail hash of `item`, a file longer than `TAIL_FROM`.
    pub(super) fn tail(&self, item: &Item) -> Result<Hash, Skip> {
        let (mut file, stamp) = self.reopen(item)?;
        lock(&self.stats).tail_reads += 1;
        let tail = hash::tail(&mut file, stamp.len).map_err(|e| skip_of(&e))?;
        self.checked(&file, stamp, item)?;
        Ok(tail)
    }

    /// The whole-file hash of `item`; `None` when the search was cancelled. Its bytes count as
    /// done also when the read fails, so that the bytes done reach the total; a cancelled read
    /// counts only what it read.
    pub(super) fn full(&self, item: &Item) -> Result<Option<Hash>, Skip> {
        let mut read = 0;
        let hash = self.read_full(item, &mut read);
        if hash != Ok(None) {
            let rest = item.object.paths[0].len.saturating_sub(read);
            self.advance(|p| p.bytes_done += rest);
        }
        hash
    }

    fn read_full(&self, item: &Item, read: &mut u64) -> Result<Option<Hash>, Skip> {
        let (mut file, stamp) = self.reopen(item)?;
        lock(&self.stats).full_reads += 1;
        // Each read adds its bytes, at most the length the file had when opened.
        let mut progress = |n: u64| {
            let n = n.min(stamp.len - *read);
            *read += n;
            self.advance(|p| p.bytes_done += n);
        };
        let hash = hash::full(&mut file, self.cancel, &mut progress).map_err(|e| skip_of(&e))?;
        let Some(hash) = hash else {
            return Ok(None);
        };
        self.checked(&file, stamp, item)?;
        self.remember(item, stamp, None, Some(hash));
        Ok(Some(hash))
    }

    /// Opens the first path of `item` again, if it still is the file the search first saw.
    fn reopen(&self, item: &Item) -> Result<(File, Stamp), Skip> {
        let at = &item.object.paths[0];
        let (file, identity, stamp) = open_checked(&at.path, at.len, at.mtime)?;
        if identity.id != item.seen {
            return Err(Skip::Changed);
        }
        Ok((file, stamp))
    }

    /// The file did not change while it was read.
    fn checked(
        &self,
        file: &File,
        stamp: Stamp,
        #[cfg_attr(
            not(test),
            expect(unused_variables, reason = "only the test hook needs it")
        )]
        item: &Item,
    ) -> Result<(), Skip> {
        #[cfg(test)]
        if let Some(hook) = self.after_read {
            hook(&item.object.paths[0].path);
        }
        verify_after(file, stamp)
    }

    /// What the cache knows of `item` as it is now open. The lock is held for the lookup only.
    fn cached(&self, item: &Item, stamp: Stamp) -> Hashes {
        let none = Hashes {
            prefix: None,
            full: None,
        };
        let Some(id) = item.object.id else {
            return none;
        };
        let volume = &self.keys[usize::from(item.object.paths[0].volume)];
        let cache = lock(self.cache);
        cache
            .get(volume, id, stamp.len, stamp.mtime)
            .unwrap_or(none)
    }

    fn remember(&self, item: &Item, stamp: Stamp, prefix: Option<Hash>, full: Option<Hash>) {
        let Some(id) = item.object.id else {
            return;
        };
        let volume = &self.keys[usize::from(item.object.paths[0].volume)];
        let (len, mtime) = (stamp.len, stamp.mtime);
        let mut cache = lock(self.cache);
        if let Some(h) = prefix {
            cache.put_prefix(volume, id, len, mtime, h);
        }
        if let Some(h) = full {
            cache.put_full(volume, id, len, mtime, h);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::AtomicBool;

    use super::super::{Item, Search, lock};
    use crate::duplicates::DiskKind;
    use crate::duplicates::group::{Location, Object, PathRef};
    use crate::duplicates::hash::open_checked;
    use crate::duplicates::tests::{MIB, cache, data, dir, put};
    use crate::scanner::mtime_of;

    #[test]
    fn a_cancelled_full_read_counts_no_bytes_it_did_not_read() {
        let d = dir();
        let path = put(d.path(), "a", &data(3 * MIB));
        let (len, mtime) = (3 * MIB as u64, mtime_of(&fs::metadata(&path).unwrap()));
        let (_, identity, _) = open_checked(&path, len, mtime).unwrap();
        let at = PathRef { root: 0, node: 1 };
        let paths = vec![Location {
            at,
            path,
            len,
            mtime,
            size: len,
            volume: 0,
        }];
        let object = Object {
            paths,
            id: identity.id,
            nlink: 1,
            protected: false,
            synced: false,
            seed: true,
        };
        let item = Item {
            object,
            seen: identity.id,
            full: None,
        };
        let (cache, cancel) = (cache(), AtomicBool::new(true));
        let emit = |_| {};
        let search = Search::new(
            vec![DiskKind::Hdd],
            vec!["v".into()],
            &cache,
            &cancel,
            &emit,
        );
        assert_eq!(search.full(&item), Ok(None));
        assert_eq!(lock(&search.progress).0.bytes_done, 0);
    }
}
