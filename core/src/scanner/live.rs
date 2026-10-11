//! Sequential root folders, parallel descendants, and owned batches for in-place edits.

use std::collections::HashSet;

use super::*;

pub enum LiveEvent {
    Started(Tree),
    FolderStarted { id: u32, bytes: u64, files: u64 },
    FolderDone { id: u32, tree: Tree },
    FolderGone { id: u32 },
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
    let volume = Volume::of(&root, &meta);
    let scan_meta = ScanMeta {
        cluster: volume.cluster,
        size_mode: volume.size_mode(),
        scanned_at: now_secs(),
    };
    let ctx = Ctx {
        tx,
        next_id: AtomicU32::new(1),
        cancel,
        progress,
        volume: &volume,
    };
    let (top, mut dirs) = listing::list(
        &ctx,
        DirTask {
            path: root.clone(),
            name: root.clone().into_os_string(),
            id: 0,
            parent: NO_PARENT,
            mtime: mtime_of(&meta),
            flags: flags::IS_DIR | listing::directory_flags(&root, &meta),
        },
    );
    if cancel.load(Ordering::Relaxed) {
        return Ok(LiveOutcome::Cancelled);
    }
    dirs.sort_by(|a, b| a.name.as_encoded_bytes().cmp(b.name.as_encoded_bytes()));
    let mut links = HashSet::new();
    let mut initial = vec![top];
    initial.extend(dirs.iter().map(|d| DirRec {
        id: d.id,
        parent: 0,
        name: d.name.clone(),
        mtime: d.mtime,
        flags: d.flags | flags::PENDING,
        files: Vec::new(),
    }));
    let mut tree = Tree::from_records_with_links(initial, scan_meta, &mut links);
    // Flat-tree ids also include root files, so resolve once before handing the tree away.
    let ids: Vec<u32> = tree
        .children(0)
        .filter(|&id| tree.node(id).is_dir())
        .collect();
    tree.set_scanning(0, true);
    publish(LiveEvent::Started(tree));
    debug_assert_eq!(dirs.len(), ids.len());
    for (mut task, id) in dirs.into_iter().zip(ids) {
        if cancel.load(Ordering::Relaxed) {
            return Ok(LiveOutcome::Cancelled);
        }
        publish(LiveEvent::FolderStarted {
            id,
            bytes: progress.bytes.load(Ordering::Relaxed),
            files: progress.files.load(Ordering::Relaxed),
        });
        if cancel.load(Ordering::Relaxed) {
            return Ok(LiveOutcome::Cancelled);
        }
        if fs::symlink_metadata(&task.path).is_err_and(|e| e.kind() == io::ErrorKind::NotFound) {
            publish(LiveEvent::FolderGone { id });
            continue;
        }
        task.id = 0;
        task.parent = NO_PARENT;
        let (tx, rx) = mpsc::channel();
        let child_ctx = Ctx {
            tx,
            next_id: AtomicU32::new(1),
            cancel,
            progress,
            // Keep the original volume rules, including macOS firmlink exclusions.
            volume: &volume,
        };
        rayon::scope(|s| walk(s, &child_ctx, task));
        drop(child_ctx);
        if cancel.load(Ordering::Relaxed) {
            return Ok(LiveOutcome::Cancelled);
        }
        let records: Vec<_> = rx.into_iter().collect();
        let tree = Tree::from_records_with_links(records, scan_meta, &mut links);
        publish(LiveEvent::FolderDone { id, tree });
    }
    Ok(if cancel.load(Ordering::Relaxed) {
        LiveOutcome::Cancelled
    } else {
        LiveOutcome::Done
    })
}

#[cfg(test)]
mod tests;
