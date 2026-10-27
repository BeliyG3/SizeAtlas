//! The options of a duplicate search: the known folders and the system (asked once), and the
//! core's roots and options built from the picked roots and the query.

use std::path::Path;
use std::time::SystemTime;

use sizeatlas_core::cleanup::{Known, Os};
use sizeatlas_core::duplicates::{Options, SearchRoot};
use sizeatlas_core::scanner::epoch_nanos;
use sizeatlas_core::tree::Query;

use super::roots::Picked;
use crate::state::AppState;

impl AppState {
    /// Asks `context` once, by the first root `first`, for the known folders and the system:
    /// before any tree is taken, as the question may take a while.
    pub(super) fn duplicates_env(&self, first: &str) {
        self.0.duplicates.env.get_or_init(|| {
            let ctx = (self.0.context)(Path::new(first));
            (ctx.known, ctx.os)
        });
    }

    /// Runs `f` with the roots of `picked` and the options of `query` (`duplicates_env` first).
    pub(super) fn searching<T>(
        &self,
        picked: &[Picked],
        query: &str,
        system: bool,
        f: impl FnOnce(&[SearchRoot], &Options) -> T,
    ) -> T {
        let fallback;
        let (known, os) = match self.0.duplicates.env.get() {
            Some(env) => env,
            // Not asked yet: no root was picked, and nothing is searched.
            None => {
                fallback = (Known::default(), Os::current());
                &fallback
            }
        };
        let roots: Vec<SearchRoot> = (picked.iter())
            .map(|p| SearchRoot {
                tree: &p.tree,
                generation: p.generation,
                volume: &p.volume,
                disk: p.disk,
                start: p.start,
            })
            .collect();
        let query = Query::parse(query);
        let opts = Options {
            query: query.as_ref(),
            include_zones: system,
            os: *os,
            known,
            now_ns: epoch_nanos(SystemTime::now()),
        };
        f(&roots, &opts)
    }
}
