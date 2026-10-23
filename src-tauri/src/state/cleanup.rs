//! The clean-up walk of a tree, shared for a few seconds by the lists of both modes: every
//! folder click in these modes would otherwise walk the whole tree again (~0.6 s at 9 M nodes).
//!
//! **Only for listing.** The checks before deleting must build a fresh context and walk again;
//! they never read this cache, so an app started meanwhile still refuses its rows.

use std::sync::{Arc, PoisonError};
use std::time::{Duration, Instant};

use sizeatlas_core::cleanup::Cleanup;

use super::AppState;
use crate::error::CmdError;

/// ponytail: one entry reused for a short time, so a browser started or closed meanwhile shows
/// up to this late in the list (deleting checks again). Upgrade: cache the matches and apply the
/// running processes per call, which needs the core's `finish` split.
const FRESH: Duration = Duration::from_secs(3);

/// A walk of the tree of `generation` at `rev`.
pub(super) struct Walked {
    generation: u64,
    rev: u64,
    at: Instant,
    cleanup: Arc<Cleanup>,
}

impl AppState {
    /// The clean-up lists of the whole tree of `generation` and the `rev` they were made at:
    /// the last walk if it is of this tree and rev and younger than [`FRESH`], else a new one.
    /// Calls wait for each other, so concurrent clicks share one walk. The context is built
    /// before the tree is taken, so a slow folder lookup never holds up a change of the tree.
    pub(super) fn walked(&self, generation: u64) -> Result<(u64, Arc<Cleanup>), CmdError> {
        let mut last = self.0.walked.lock().unwrap_or_else(PoisonError::into_inner);
        let (rev, root) = {
            let tree = self.tree(generation)?;
            (tree.rev, tree.path(0))
        };
        let fresh =
            |w: &&Walked| (w.generation, w.rev) == (generation, rev) && w.at.elapsed() < FRESH;
        if let Some(w) = last.as_ref().filter(fresh) {
            return Ok((w.rev, w.cleanup.clone()));
        }
        let at = Instant::now();
        let ctx = (self.0.context)(&root);
        let tree = self.tree(generation)?;
        let walked = Walked {
            generation,
            rev: tree.rev,
            at,
            cleanup: Arc::new(tree.cleanup(&ctx)),
        };
        let out = (walked.rev, walked.cleanup.clone());
        *last = Some(walked);
        Ok(out)
    }
}
