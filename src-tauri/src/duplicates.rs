//! The duplicate search of the app: one background job at a time over every open root, or over
//! one folder of one (a scope; see `sizeatlas_core::duplicates`), its result kept until the next
//! search and read by cursor, its progress sent as `duplicates-status`. A result is stale once
//! the `(generation, rev)` of a searched root changes, or (without a scope) the set of open
//! roots does; a running job then cancels itself.
//!
//! Locks: `Inner` is held only for short steps in memory, never across `.await`, IO or a
//! callback; under it the queue and the data locks may be taken (in that order, for staleness),
//! so neither is ever held while `Inner` is taken. Nobody holds an `Arc<Tree>` while taking
//! `Inner`, and a job holds no tree at all: `prepare` copies what it needs.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::thread::{self, JoinHandle};

use sizeatlas_core::cleanup::{Known, Os};
use sizeatlas_core::duplicates::cache::HashCache;
use sizeatlas_core::duplicates::results::{Results, RootMark};
use sizeatlas_core::duplicates::{self as core, DiskKind};

use crate::dto::{DuplicatesDto, EstimateDto, GroupDto, ScopeDto, StatusDto, hex};
use crate::error::CmdError;
use crate::state::AppState;

mod decide;
mod job;
mod options;
mod roots;
mod select;
pub mod thumb;
pub mod trash;

use roots::scope_path;

/// Where the statuses of a job go: the `duplicates-status` event, or a test.
pub type Emit = Arc<dyn Fn(StatusDto) + Send + Sync>;

#[derive(Default)]
pub struct Duplicates {
    inner: Mutex<Inner>,
    /// Trash requests of duplicates registered and not ended. Outside `Inner`: the guard of a
    /// confirmed request lowers it without the lock.
    trashing: AtomicU32,
    cache: Mutex<HashCache>,
    /// The known folders and the system, from `context` once (by the first root): asking it on
    /// every estimate would list the processes and wake external disks.
    env: OnceLock<(Known, Os)>,
    /// How often the disks of the machine were listed.
    #[cfg(test)]
    mounts_read: std::sync::atomic::AtomicUsize,
}

#[derive(Default)]
struct Inner {
    /// The id of the last job; jobs count from 1.
    next_job: u64,
    running: Option<(u64, Arc<AtomicBool>)>,
    results: Option<Results>,
    /// The trash queue key of each root of `results` (one per `RootMark`).
    volumes: Vec<String>,
    /// The disk of each root of `results`, for the copy a thumbnail reads.
    disks: Vec<DiskKind>,
    query: String,
    system: bool,
    /// The scope of the search, and the full path of its folder.
    scope: Option<ScopeDto>,
    scope_path: Option<String>,
    status: StatusDto,
    skipped: Vec<String>,
}

impl AppState {
    fn duplicates(&self) -> MutexGuard<'_, Inner> {
        (self.0.duplicates.inner)
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// What a search for `query` (with the zones when `system`; of the folder `scope`, else of
    /// every open root) would compare; reads no file. A scope out of date is `StaleId`.
    pub fn estimate_duplicates(
        &self,
        query: &str,
        system: bool,
        scope: Option<&ScopeDto>,
    ) -> Result<EstimateDto, CmdError> {
        let (picked, skipped) = roots::pick(self, false, scope)?;
        let e = self.searching(&picked, query, system, |roots, opts| {
            core::estimate(roots, opts)
        });
        Ok(EstimateDto {
            files: e.files,
            bytes: e.bytes,
            eligible: e.eligible,
            seeded: e.seeded,
            roots: picked.len() as u32,
            skipped,
            scope: scope_path(&picked, scope),
        })
    }

    /// Starts a search job for `query` on a thread of its own and returns its id; a running job
    /// is cancelled. Refused (`Busy`) while a trash request of duplicates is registered, and
    /// (`StaleId`) for a scope out of date. With the query, the scope and the roots of the last
    /// result, the new one starts with its groups.
    pub fn find_duplicates(
        &self,
        query: String,
        system: bool,
        scope: Option<ScopeDto>,
        emit: Emit,
    ) -> Result<(u64, JoinHandle<()>), CmdError> {
        let trashing = || self.0.duplicates.trashing.load(Ordering::Acquire) > 0;
        // Before the trees are read; asked again where it counts, under the lock below.
        if trashing() {
            return Err(CmdError::Busy);
        }
        let (picked, skipped) = roots::pick(self, true, scope.as_ref())?;
        let path = scope_path(&picked, scope.as_ref());
        let marks: Vec<RootMark> = (picked.iter())
            .map(|p| RootMark {
                path: p.root.clone(),
                generation: p.generation,
                rev: p.tree.rev,
            })
            .collect();
        let volumes = picked.iter().map(|p| p.volume.clone()).collect();
        let disks = picked.iter().map(|p| p.disk).collect();
        let prepared = self.searching(&picked, &query, system, |roots, opts| {
            core::prepare(roots, opts)
        });
        // The job holds no tree: a change of one never waits for it (`state::change::tree_mut`).
        drop(picked);
        let cancel = Arc::new(AtomicBool::new(false));
        let job = {
            let mut inner = self.duplicates();
            // Under the lock a trash request registers under (Task 6): no race with it.
            if trashing() {
                return Err(CmdError::Busy);
            }
            if let Some((_, old)) = inner.running.take() {
                old.store(true, Ordering::Relaxed);
            }
            inner.next_job += 1;
            let job = inner.next_job;
            let same = inner.query == query && inner.system == system && inner.scope == scope;
            let previous = inner.results.take().filter(|_| same);
            // `Results::new` keeps the old groups only for the same root marks.
            inner.results = Some(Results::new(job, marks, previous.as_ref()));
            inner.running = Some((job, cancel.clone()));
            inner.volumes = volumes;
            inner.disks = disks;
            inner.query = query;
            inner.system = system;
            inner.scope = scope;
            inner.scope_path = path;
            inner.skipped = skipped;
            inner.status = StatusDto {
                job,
                running: true,
                ..StatusDto::default()
            };
            job
        };
        let state = self.clone();
        let handle = thread::spawn(move || state.run_job(job, prepared, &cancel, &*emit));
        Ok((job, handle))
    }

    /// Stops the running job; what it found stays, marked not complete.
    pub fn cancel_duplicates(&self) {
        if let Some((_, cancel)) = &self.duplicates().running {
            cancel.store(true, Ordering::Relaxed);
        }
    }

    /// What changed in the result after `cursor` of `job`: all of it for another job or the
    /// cursor 0. Without a result `job` is 0.
    pub fn duplicates_since(&self, job: u64, cursor: u64) -> DuplicatesDto {
        let inner = self.duplicates();
        let stale = self.stale_in(&inner);
        let mut dto = DuplicatesDto {
            running: inner.running.is_some(),
            stale,
            full: true,
            query: inner.query.clone(),
            system: inner.system,
            scope: inner.scope_path.clone(),
            skipped: inner.skipped.clone(),
            status: StatusDto {
                stale,
                ..inner.status.clone()
            },
            ..DuplicatesDto::default()
        };
        if let Some(r) = &inner.results {
            let delta = r.since(job, cursor);
            dto.job = r.job;
            dto.version = r.version;
            dto.complete = r.complete;
            dto.full = delta.full;
            dto.groups = (delta.groups.iter())
                .map(|g| GroupDto::of(g, &r.roots, &inner.disks))
                .collect();
            dto.removed = delta.removed.iter().map(hex).collect();
            dto.unread = r.unread.clone();
        }
        dto
    }

    /// The set of searched roots, or the `(generation, rev)` of one, changed since the search.
    /// Never under `Inner`: there use `stale_in`. The app reads it from the statuses instead.
    #[cfg(test)]
    pub(crate) fn duplicates_stale(&self) -> bool {
        let inner = self.duplicates();
        self.stale_in(&inner)
    }

    #[cfg(test)]
    pub(crate) fn duplicates_running(&self) -> bool {
        self.duplicates().running.is_some()
    }

    fn stale_in(&self, inner: &Inner) -> bool {
        let Some(r) = &inner.results else {
            return false;
        };
        let (now, _) = roots::current(self);
        let changed = r.roots.iter().any(|m| !now.contains(m));
        // A search of one folder takes no other root: opening or closing one changes nothing.
        changed || (inner.scope.is_none() && now.len() != r.roots.len())
    }
}

#[cfg(test)]
mod kept_tests;
#[cfg(test)]
mod queue_tests;
#[cfg(test)]
mod race_tests;
#[cfg(test)]
mod roots_tests;
#[cfg(test)]
mod scope_tests;
#[cfg(test)]
mod scope_trash_tests;
#[cfg(test)]
mod stale_tests;
#[cfg(test)]
mod status_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod thumb_tests;
#[cfg(test)]
mod trash_fixture;
#[cfg(test)]
mod trash_tests;
#[cfg(test)]
mod waits_tests;
