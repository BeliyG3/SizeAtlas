//! The first-scan publication path, including preallocated grafts, without an application UI.

use std::io;
use std::path::Path;
use std::sync::atomic::AtomicBool;

use sizeatlas_core::scanner::{self, LiveEvent, LiveOutcome, Progress, ScanOutcome};

pub(super) fn scan(root: &Path) -> io::Result<ScanOutcome> {
    let mut tree = None;
    let outcome = scanner::scan_live(
        root,
        &AtomicBool::new(false),
        &Progress::default(),
        |event| match event {
            LiveEvent::Started(initial) => tree = Some(initial),
            LiveEvent::FolderStarted { .. } => {}
            LiveEvent::FolderDone { id, tree: sub } => {
                let tree = tree.as_mut().expect("root published");
                let buffer = tree.graft_buffer(sub.len() - 1);
                tree.reserve_graft(buffer);
                tree.graft(id, sub);
            }
            LiveEvent::FolderGone { id } => tree.as_mut().expect("root published").remove(id),
        },
    )?;
    if outcome == LiveOutcome::Cancelled {
        return Ok(ScanOutcome::Cancelled);
    }
    let mut tree = tree.expect("root published");
    tree.set_scanning(0, false);
    tree.approximate = false;
    Ok(ScanOutcome::Done(tree))
}
