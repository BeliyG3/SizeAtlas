//! A search job on its own thread: its groups go into the result, its progress to `emit`, then
//! a last status. It holds no tree and takes `Inner` only for short steps, never around `emit`.

use std::sync::atomic::{AtomicBool, Ordering};

use sizeatlas_core::duplicates::{self as core, Event, Prepared, Progress};

use crate::dto::StatusDto;
use crate::state::AppState;

impl AppState {
    /// The search of `job`: its groups go into the result, its progress to `emit`, then a last
    /// status. A job replaced by another changes nothing and sends nothing more.
    pub(super) fn run_job(
        &self,
        job: u64,
        prepared: Prepared,
        cancel: &AtomicBool,
        emit: &(dyn Fn(StatusDto) + Sync),
    ) {
        let _ended = Ended { state: self, job };
        let on_event = |event: Event| match event {
            Event::Group(group) => {
                // A late group of a replaced job is dropped by its id.
                if let Some(r) = self.duplicates().results.as_mut() {
                    r.upsert(job, group);
                }
            }
            Event::Progress(p) => {
                let Some(status) = self.progressed(job, p) else {
                    return;
                };
                if self.duplicates_stale() {
                    cancel.store(true, Ordering::Relaxed);
                }
                emit(status);
            }
        };
        let outcome = core::search(prepared, &self.0.duplicates.cache, cancel, &on_event);
        let status = {
            let mut inner = self.duplicates();
            let Some(r) = inner.results.as_mut() else {
                return;
            };
            if !r.finish(job, outcome.complete, outcome.unread) {
                return;
            }
            let version = r.version;
            inner.running = None;
            inner.status.running = false;
            inner.status.version = version;
            inner.status.clone()
        };
        emit(status);
    }

    /// Takes the progress `p` of `job` into its status; `None` once the job was replaced.
    fn progressed(&self, job: u64, p: Progress) -> Option<StatusDto> {
        let mut inner = self.duplicates();
        if inner.status.job != job {
            return None;
        }
        let version = inner.results.as_ref().map_or(0, |r| r.version);
        inner.status = StatusDto {
            job,
            version,
            running: true,
            phase: Some(p.phase),
            files_done: p.files_done,
            files_total: p.files_total,
            bytes_done: p.bytes_done,
            bytes_total: p.bytes_total,
        };
        Some(inner.status.clone())
    }
}

/// Clears `running` when a job ends, also by a panic, but only for its own job.
struct Ended<'a> {
    state: &'a AppState,
    job: u64,
}

impl Drop for Ended<'_> {
    fn drop(&mut self) {
        let mut inner = self.state.duplicates();
        if inner
            .running
            .as_ref()
            .is_some_and(|(job, _)| *job == self.job)
        {
            inner.running = None;
        }
    }
}
