use std::fs::Metadata;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use crate::tree::SizeMode;

/// The file system being scanned; directories on other devices are not entered.
pub struct Volume {
    pub cluster: u64,
    dev: u64,
    extra_dev: Option<u64>,
    skip: Option<PathBuf>,
}

impl Volume {
    pub fn of(root: &Path, meta: &Metadata) -> Volume {
        let mut volume = Volume {
            cluster: 0,
            dev: meta.dev(),
            extra_dev: None,
            skip: None,
        };
        if cfg!(target_os = "macos") && root == Path::new("/") {
            // User data lives on the Data volume and is reachable from `/` through firmlinks
            // (/Users, /Applications…). Its own mount point is skipped to avoid counting it twice.
            let data = PathBuf::from("/System/Volumes/Data");
            if let Ok(m) = std::fs::symlink_metadata(&data) {
                volume.extra_dev = Some(m.dev());
                volume.skip = Some(data);
            }
        }
        volume
    }

    pub fn allows_dir(&self, path: &Path, meta: &Metadata) -> bool {
        let same_fs = meta.dev() == self.dev || Some(meta.dev()) == self.extra_dev;
        same_fs && self.skip.as_deref() != Some(path)
    }

    pub fn size_mode(&self) -> SizeMode {
        SizeMode::Allocated
    }

    pub fn disk_size(&self, meta: &Metadata, _path: impl FnOnce() -> PathBuf) -> u64 {
        meta.blocks() * 512
    }
}

pub fn dir_flags(_meta: &Metadata) -> u8 {
    0
}

pub fn hardlink_key(meta: &Metadata) -> Option<(u64, u64)> {
    (meta.nlink() > 1).then(|| (meta.dev(), meta.ino()))
}

/// Every item may be tried: macOS and Linux have a trash per user. The `trash` crate moves an
/// item into the home trash; across devices it copies the item and then deletes the original,
/// and a failure is reported as an error per item, so nothing is deleted for good.
pub fn can_recycle(_path: &Path, _size: u64) -> bool {
    true
}
