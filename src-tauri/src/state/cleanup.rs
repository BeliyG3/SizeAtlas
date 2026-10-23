//! The clean-up walk of a tree, kept for the lists of both modes until the tree or the folders it
//! depends on change: every folder click in these modes, and every return to one, would otherwise
//! walk the whole tree again (~0.6 s at 9 M nodes, several seconds in a debug build). The running
//! processes are read and applied on every call, so a browser started or closed shows at once.
//!
//! **Only for listing.** The checks before deleting must build a fresh context and walk again;
//! they never read this cache, so an app started meanwhile still refuses its rows.

use std::sync::{Arc, PoisonError};

use sizeatlas_core::cleanup::{Context, Matches, Running};

use super::AppState;
use crate::error::CmdError;

/// The walk of the tree of `generation` at `rev`, made with `ctx` (its processes left out).
pub(super) struct Walked {
    generation: u64,
    rev: u64,
    ctx: Context,
    matches: Arc<Matches>,
}

impl AppState {
    /// The matches of the whole tree of `generation`, the `rev` they were made at and the
    /// processes running now: the last walk if it is of this tree, rev and context, else a new
    /// one. Calls wait for each other, so concurrent clicks share one walk. The context is built
    /// before the tree is taken, so a slow folder lookup never holds up a change of the tree.
    pub(super) fn walked(
        &self,
        generation: u64,
    ) -> Result<(u64, Arc<Matches>, Vec<Running>), CmdError> {
        let mut last = self.0.walked.lock().unwrap_or_else(PoisonError::into_inner);
        let (rev, root) = {
            let tree = self.tree(generation)?;
            (tree.rev, tree.path(0))
        };
        let mut ctx = (self.0.context)(&root);
        let running = std::mem::take(&mut ctx.running);
        let same =
            |w: &&Walked| (w.generation, w.rev) == (generation, rev) && same_walk(&w.ctx, &ctx);
        if let Some(w) = last.as_ref().filter(same) {
            return Ok((w.rev, w.matches.clone(), running));
        }
        let tree = self.tree(generation)?;
        let walked = Walked {
            generation,
            rev: tree.rev,
            matches: Arc::new(tree.matches(&ctx)),
            ctx,
        };
        let out = (walked.rev, walked.matches.clone(), running);
        *last = Some(walked);
        Ok(out)
    }
}

/// Whether a walk with `a` finds what one with `b` would: everything but the processes counts.
fn same_walk(a: &Context, b: &Context) -> bool {
    (a.os, &a.known, a.reboot_pending, a.recyclable)
        == (b.os, &b.known, b.reboot_pending, b.recyclable)
}
