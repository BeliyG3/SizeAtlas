//! What a search finds: groups of files with equal content, each file an object that may have
//! several paths (hard links), and how much removing the copies would free.

use std::collections::HashMap;
use std::path::PathBuf;

use super::candidates::Candidate;
use super::hash::Hash;
use crate::platform::{FileId, Identity};

/// A file of a searched tree: the index of its root and its node.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PathRef {
    pub root: u16,
    pub node: u32,
}

/// One path of a file, with what the scan saw of it.
#[derive(Clone, Debug)]
pub struct Location {
    pub at: PathRef,
    pub path: PathBuf,
    pub len: u64,
    pub mtime: i64,
    pub size: u64,
    /// Index of the volume of the path among the searched ones.
    pub volume: u16,
}

/// One file on disk: every found path of it, and whether it may be kept or removed.
#[derive(Clone, Debug)]
pub struct Object {
    pub paths: Vec<Location>,
    /// `None` when it could not be told: then the file is neither kept nor removed.
    pub id: Option<FileId>,
    pub nlink: u64,
    /// One of its paths lies in a zone.
    pub protected: bool,
    /// One of its paths lies in a cloud sync folder.
    pub synced: bool,
    /// One of its paths fits the query.
    pub seed: bool,
}

impl Object {
    /// The space it takes: the largest size of its paths (a second Unix link has size 0).
    pub fn size(&self) -> u64 {
        self.paths.iter().map(|p| p.size).max().unwrap_or(0)
    }

    /// Links outside the found paths keep the file on disk whatever is removed here.
    pub fn outside_links(&self) -> bool {
        self.nlink > self.paths.len() as u64
    }

    /// May be the copy that stays.
    pub fn keepable(&self) -> bool {
        self.id.is_some() && !self.protected
    }

    /// May be removed, and removing it frees its space.
    pub fn trashable(&self) -> bool {
        self.keepable() && !self.outside_links()
    }
}

/// Files of one length and one whole-file hash.
#[derive(Clone, Debug)]
pub struct Group {
    pub hash: Hash,
    pub len: u64,
    pub objects: Vec<Object>,
    /// The disk may no longer match: search again before removing.
    pub stale: bool,
}

impl Group {
    /// At most what removing copies frees: every removable copy but the largest one, which
    /// stays; all of them when a copy linked from elsewhere stays anyway.
    pub fn free(&self) -> u64 {
        let sizes = || {
            self.objects
                .iter()
                .filter(|o| o.trashable())
                .map(Object::size)
        };
        let total: u64 = sizes().sum();
        let held = self.objects.iter().any(|o| o.keepable() && !o.trashable());
        if held {
            total
        } else {
            total - sizes().max().unwrap_or(0)
        }
    }

    /// One of its files fits the query.
    pub fn seeded(&self) -> bool {
        self.objects.iter().any(|o| o.seed)
    }
}

/// The opened paths as objects: paths of one file id and one length on one volume become one
/// object. Equal ids on different volumes (a cloned volume keeps its serial number), or of
/// different lengths (a server reusing ids across the file systems of a share), are told apart
/// by nothing, so their objects get no id; a path without an id is an object of its own.
pub(crate) fn merge_by_id(opened: Vec<(Location, Identity, Candidate)>) -> Vec<Object> {
    let mut objects: Vec<Object> = Vec::new();
    let mut found: HashMap<(u16, FileId), usize> = HashMap::new();
    let mut first_volume: HashMap<FileId, u16> = HashMap::new();
    let mut clashes = Vec::new();
    for (at, identity, c) in opened {
        let mut join = None;
        if let Some(id) = identity.id {
            if *first_volume.entry(id).or_insert(at.volume) != at.volume {
                clashes.push(id);
            }
            match found.get(&(at.volume, id)) {
                Some(&i) if objects[i].paths[0].len == at.len => join = Some(i),
                Some(_) => clashes.push(id),
                None => {
                    found.insert((at.volume, id), objects.len());
                }
            }
        }
        match join {
            Some(i) => {
                let o = &mut objects[i];
                o.paths.push(at);
                o.nlink = o.nlink.max(identity.nlink);
                o.protected |= c.protected;
                o.synced |= c.synced;
                o.seed |= c.seed;
            }
            None => objects.push(Object {
                paths: vec![at],
                id: identity.id,
                nlink: identity.nlink,
                protected: c.protected,
                synced: c.synced,
                seed: c.seed,
            }),
        }
    }
    for o in &mut objects {
        if o.id.is_some_and(|id| clashes.contains(&id)) {
            o.id = None;
        }
    }
    objects
}
