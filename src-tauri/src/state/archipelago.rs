//! The archipelago: the islands of the open drives, each built facing the others where they
//! stand and moved to its place, and the bridges between them (see `sizeatlas_core::city::place`
//! and `bridges`). A drive's `get_city` serves its island of the archipelago.

use std::panic::resume_unwind;
use std::path::Path;
use std::thread;

use sizeatlas_core::city::{self, Island};

use super::AppState;
use super::island::{Kept, Member, free_space, members_of, step, survey};
use crate::dto::{ArchipelagoBridgeDto, ArchipelagoDto, ArchipelagoIslandDto};
use crate::error::CmdError;

fn refs(kept: &[Kept]) -> Vec<&Island> {
    kept.iter().map(|(_, island, _)| &**island).collect()
}

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
        let (list, revs) = self.open_members(mounts, disks);
        let open: Vec<u64> = revs.iter().map(|(g, _)| *g).collect();
        // `(generation, root)` in the order of the members; a root that is no member is alone.
        let (roots, kept, offsets) = if list.iter().any(|m| m.generation == selected) {
            let (kept, offsets) = self.settle(&list, &revs, true)?;
            let roots = list.into_iter().map(|m| (m.generation, m.root)).collect();
            (roots, kept, offsets)
        } else {
            let kept = vec![self.alone(selected, disks, &open)?];
            let offsets = city::place(&refs(&kept));
            (vec![(selected, root)], kept, offsets)
        };
        let bridges = city::bridges(&refs(&kept), &offsets);
        // serde_json writes a number that is not finite as `null`.
        debug_assert!(offsets.iter().flatten().all(|v| v.is_finite()));
        debug_assert!(
            (bridges.iter().flat_map(|b| &b.points))
                .flatten()
                .all(|v| v.is_finite())
        );
        Ok(ArchipelagoDto {
            islands: (roots.into_iter().zip(&offsets).zip(&kept))
                .map(
                    |(((generation, root), at), (rev, ..))| ArchipelagoIslandDto {
                        generation,
                        rev: *rev,
                        root,
                        x: at[0],
                        z: at[1],
                    },
                )
                .collect(),
            bridges: bridges
                .into_iter()
                .map(ArchipelagoBridgeDto::from)
                .collect(),
        })
    }

    /// Encoded island map of the whole root `generation` (see `sizeatlas_core::city`). A drive's
    /// is its island of the archipelago, gates facing the other open drives; a root that is not
    /// a drive has none.
    pub fn city(&self, generation: u64, cache_dir: &Path) -> Result<Vec<u8>, CmdError> {
        // A stale generation answers before the disks are listed.
        self.with_live(generation, 0, |_| ())?;
        let (mounts, disks) = survey(cache_dir);
        self.city_in(generation, &mounts, &disks)
    }

    /// [`AppState::city`] with the mount points and the free space of the disks given.
    pub(super) fn city_in(
        &self,
        generation: u64,
        mounts: &[String],
        disks: &[(String, u64)],
    ) -> Result<Vec<u8>, CmdError> {
        let (list, revs) = self.open_members(mounts, disks);
        let open: Vec<u64> = revs.iter().map(|(g, _)| *g).collect();
        let (_, _, bytes) = match list.iter().position(|m| m.generation == generation) {
            Some(me) => self.settle(&list, &revs, false)?.0.swap_remove(me),
            None => self.alone(generation, disks, &open)?,
        };
        Ok(bytes)
    }

    /// The members among the open roots and the `(generation, rev)` of every open root. The
    /// trees are let go before it returns: a change of a tree waits, holding the write lock,
    /// until no copy of it is left, so a copy held while the islands are built (each of them
    /// takes the read lock) would hold both forever.
    pub(super) fn open_members(
        &self,
        mounts: &[String],
        disks: &[(String, u64)],
    ) -> (Vec<Member>, Vec<(u64, u64)>) {
        let trees = self.open_trees();
        let list = members_of(&trees, mounts, disks);
        let revs = trees.iter().map(|(g, t)| (*g, t.rev)).collect();
        (list, revs)
    }

    /// The island of a root that is no drive: no gates, the free space of its disk.
    fn alone(
        &self,
        generation: u64,
        disks: &[(String, u64)],
        open: &[u64],
    ) -> Result<Kept, CmdError> {
        let free = self.with_live(generation, 0, |tree| {
            step(free_space(tree.name(0), disks, tree.volume))
        })?;
        self.island_in(generation, free, &[], open)
    }

    /// The islands of the members `list` (of the open roots `revs`, in its order) and where they
    /// stand, built facing the places [`city::directions`] foresees (see
    /// [`AppState::settle_with`]).
    fn settle(
        &self,
        list: &[Member],
        revs: &[(u64, u64)],
        fresh: bool,
    ) -> Result<(Vec<Kept>, Vec<[f32; 2]>), CmdError> {
        let sizes: Vec<(u64, u64)> = list.iter().map(|m| (m.used, m.free)).collect();
        let foreseen: Vec<Vec<f32>> = (0..list.len())
            .map(|me| city::directions(&sizes, me))
            .collect();
        self.settle_with(list, revs, &foreseen, fresh)
    }

    /// The islands of the members `list` and where they stand. Unless `fresh`, the world last
    /// laid out for the same members, revs and sizes (whatever the free space did since: one
    /// world serves the archipelago and every `get_city`). Else they are built facing
    /// `foreseen`; where [`city::place_on_rays`] puts them elsewhere (not [`city::settled`]),
    /// built again facing where they stand there. Then [`city::place`] stands them gate against
    /// gate where it can. One caller lays a world out at a time.
    pub(super) fn settle_with(
        &self,
        list: &[Member],
        revs: &[(u64, u64)],
        foreseen: &[Vec<f32>],
        fresh: bool,
    ) -> Result<(Vec<Kept>, Vec<[f32; 2]>), CmdError> {
        let rev = |g: u64| revs.iter().find(|(t, _)| *t == g).map(|&(_, r)| r);
        let key: Vec<(u64, u64, u64)> = (list.iter())
            .map(|m| (m.generation, rev(m.generation).unwrap_or(0), m.used))
            .collect();
        let mut world = self.0.city.world.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((have, kept, at)) = world.as_ref()
            && !fresh
            && *have == key
        {
            return Ok((kept.clone(), at.clone()));
        }
        let open: Vec<u64> = revs.iter().map(|(g, _)| *g).collect();
        let (kept, at) = self.lay_out(list, foreseen, &open)?;
        *world = Some((key, kept.clone(), at.clone()));
        Ok((kept, at))
    }

    /// The two passes of [`AppState::settle_with`].
    fn lay_out(
        &self,
        list: &[Member],
        foreseen: &[Vec<f32>],
        open: &[u64],
    ) -> Result<(Vec<Kept>, Vec<[f32; 2]>), CmdError> {
        let first = self.build(list, foreseen, open)?;
        // The gates face the islands where they stand on their rays; then they stand gate
        // against gate where they can (see `city::place`).
        let rays = city::place_on_rays(&refs(&first));
        let real = city::bearings(&refs(&first), &rays);
        if city::settled(foreseen, &real) {
            let at = city::place(&refs(&first));
            return Ok((first, at));
        }
        let second = self.build(list, &real, open)?;
        let at = city::place(&refs(&second));
        Ok((second, at))
    }

    /// The island of every member of `list`, its gates facing `aims`, side by side; those in
    /// memory answer at once.
    fn build(
        &self,
        list: &[Member],
        aims: &[Vec<f32>],
        open: &[u64],
    ) -> Result<Vec<Kept>, CmdError> {
        // ponytail: scoped threads, one per island (at most eight), as the app has no rayon.
        thread::scope(|scope| {
            let jobs: Vec<_> = (list.iter().zip(aims))
                .map(|(m, aim)| scope.spawn(|| self.island_in(m.generation, m.free, aim, open)))
                .collect();
            (jobs.into_iter())
                .map(|job| job.join().unwrap_or_else(|panic| resume_unwind(panic)))
                .collect()
        })
    }
}

#[cfg(test)]
#[path = "archipelago_tests.rs"]
mod tests;
