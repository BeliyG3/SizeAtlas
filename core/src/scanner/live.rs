//! Sequential root folders, parallel descendants, and owned batches for in-place edits.

use std::collections::HashSet;

use super::*;

pub enum LiveEvent {
    Started(Tree),
    FolderStarted { id: u32, bytes: u64, files: u64 },
    FolderDone { id: u32, records: Vec<DirRec> },
}

#[derive(Debug, PartialEq, Eq)]
pub enum LiveOutcome {
    Done,
    Cancelled,
}

/// Publishes root files and pending folders, then complete folders in name-byte order.
/// The callback owns each batch; the walker never holds a shared tree or an application lock.
pub fn scan_live(
    root: &Path,
    cancel: &AtomicBool,
    progress: &Progress,
    mut publish: impl FnMut(LiveEvent),
) -> io::Result<LiveOutcome> {
    #[cfg(target_os = "macos")]
    platform::forbid_cloud_downloads();
    let root = dunce::canonicalize(root)?;
    let meta = fs::symlink_metadata(&root)?;
    if !meta.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "scan root is not a directory",
        ));
    }
    let (tx, _rx) = mpsc::channel();
    let ctx = Ctx {
        tx,
        next_id: AtomicU32::new(1),
        cancel,
        progress,
        volume: Volume::of(&root, &meta),
    };
    let (mut top, mut dirs) = listing::list(
        &ctx,
        DirTask {
            path: root.clone(),
            name: root.clone().into_os_string(),
            id: 0,
            parent: NO_PARENT,
            mtime: mtime_of(&meta),
            flags: flags::IS_DIR | platform::dir_flags(&meta),
        },
    );
    if cancel.load(Ordering::Relaxed) {
        return Ok(LiveOutcome::Cancelled);
    }
    dirs.sort_by(|a, b| a.name.as_encoded_bytes().cmp(b.name.as_encoded_bytes()));
    let mut links = HashSet::new();
    deduplicate(std::slice::from_mut(&mut top), &mut links);
    let mut initial = vec![top];
    initial.extend(dirs.iter().map(|d| DirRec {
        id: d.id,
        parent: 0,
        name: d.name.clone(),
        mtime: d.mtime,
        flags: d.flags | flags::PENDING,
        files: Vec::new(),
    }));
    let mut tree = Tree::from_records(
        initial,
        ScanMeta {
            cluster: ctx.volume.cluster,
            size_mode: ctx.volume.size_mode(),
            scanned_at: now_secs(),
        },
    );
    // Flat-tree ids also include root files, so resolve once before handing the tree away.
    let ids: Vec<u32> = tree
        .children(0)
        .filter(|&id| tree.node(id).is_dir())
        .collect();
    tree.set_scanning(0, true);
    publish(LiveEvent::Started(tree));
    for (mut task, id) in dirs.into_iter().zip(ids) {
        if cancel.load(Ordering::Relaxed) {
            return Ok(LiveOutcome::Cancelled);
        }
        publish(LiveEvent::FolderStarted {
            id,
            bytes: progress.bytes.load(Ordering::Relaxed),
            files: progress.files.load(Ordering::Relaxed),
        });
        task.id = 0;
        task.parent = NO_PARENT;
        let (tx, rx) = mpsc::channel();
        let child_ctx = Ctx {
            tx,
            next_id: AtomicU32::new(1),
            cancel,
            progress,
            // Keep the original volume rules, including macOS firmlink exclusions.
            volume: Volume::of(&root, &meta),
        };
        rayon::scope(|s| walk(s, &child_ctx, task));
        drop(child_ctx);
        if cancel.load(Ordering::Relaxed) {
            return Ok(LiveOutcome::Cancelled);
        }
        let mut records: Vec<_> = rx.into_iter().collect();
        deduplicate(&mut records, &mut links);
        publish(LiveEvent::FolderDone { id, records });
    }
    Ok(if cancel.load(Ordering::Relaxed) {
        LiveOutcome::Cancelled
    } else {
        LiveOutcome::Done
    })
}

/// Keep hard-link accounting global across separately flattened folders. Retain the flag for
/// later refresh/trash approximation, but consume keys so flatten does not deduplicate again.
fn deduplicate(records: &mut [DirRec], seen: &mut HashSet<(u64, u64)>) {
    for file in records.iter_mut().flat_map(|r| &mut r.files) {
        if let Some(key) = file.ino.take() {
            file.flags |= flags::HARDLINK;
            if !seen.insert(key) {
                file.size = 0;
            }
        }
    }
}

#[cfg(test)]
mod tests;
