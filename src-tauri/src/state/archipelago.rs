//! The archipelago: the islands of the open drives, each moved to its place, and the bridges
//! between them (see `sizeatlas_core::city::place` and `bridges`).

use std::panic::resume_unwind;
use std::path::Path;
use std::thread;

use sizeatlas_core::city::{self, Island};

use super::AppState;
use super::island::{members_of, survey};
use crate::dto::{ArchipelagoBridgeDto, ArchipelagoDto, ArchipelagoIslandDto};
use crate::error::CmdError;

impl AppState {
    /// The world around the root `selected`: all open drives if it is one, else only itself.
    pub fn archipelago(&self, selected: u64, cache_dir: &Path) -> Result<ArchipelagoDto, CmdError> {
        // A stale generation answers before the disks are listed.
        self.with_live(selected, 0, |_| ())?;
        let (mounts, disks) = survey(cache_dir);
        self.archipelago_in(selected, &mounts, &disks)
    }

    /// [`AppState::archipelago`] with the mount points and the free space of the disks given.
    pub(super) fn archipelago_in(
        &self,
        selected: u64,
        mounts: &[String],
        disks: &[(String, u64)],
    ) -> Result<ArchipelagoDto, CmdError> {
        let root = self.with_live(selected, 0, |tree| tree.name(0).to_owned())?;
        let list = members_of(&self.open_trees(), mounts, disks);
        // `(generation, root)` in the order of the members; a root that is no member is alone.
        let roots: Vec<(u64, String)> = if list.iter().any(|m| m.generation == selected) {
            list.into_iter().map(|m| (m.generation, m.root)).collect()
        } else {
            vec![(selected, root)]
        };
        // Each island is built the way `city` builds it, so that it lands in the cache under the
        // key `city` will ask for; those the cache has answer at once.
        // ponytail: scoped threads, one per island (at most eight), as the app has no rayon.
        let built: Vec<Result<Vec<u8>, CmdError>> = thread::scope(|scope| {
            let jobs: Vec<_> = (roots.iter())
                .map(|(generation, _)| scope.spawn(|| self.city_in(*generation, mounts, disks)))
                .collect();
            (jobs.into_iter())
                .map(|job| job.join().unwrap_or_else(|panic| resume_unwind(panic)))
                .collect()
        });
        built.into_iter().try_for_each(|r| r.map(drop))?;
        let islands = (roots.iter())
            .map(|(generation, _)| self.0.city.island(*generation).ok_or(CmdError::StaleId))
            .collect::<Result<Vec<_>, _>>()?;
        let refs: Vec<&Island> = islands.iter().map(|island| &**island).collect();
        let offsets = city::place(&refs);
        let bridges = city::bridges(&refs, &offsets);
        Ok(ArchipelagoDto {
            islands: (roots.into_iter().zip(&offsets))
                .map(|((generation, root), at)| ArchipelagoIslandDto {
                    generation,
                    root,
                    x: at[0],
                    z: at[1],
                })
                .collect(),
            bridges: bridges
                .into_iter()
                .map(ArchipelagoBridgeDto::from)
                .collect(),
        })
    }
}

#[cfg(test)]
#[path = "archipelago_tests.rs"]
mod tests;
