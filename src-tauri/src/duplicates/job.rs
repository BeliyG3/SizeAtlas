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
        let ended = Ended {
            state: self,
            job,
            emit,
        };
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
                if status.stale {
                    cancel.store(true, Ordering::Relaxed);
                }
                emit(status);
            }
        };
        let outcome = core::search(prepared, &self.0.duplicates.cache, cancel, &on_event);
        // A replaced job changes nothing: `finish` refuses another job.
        if let Some(r) = self.duplicates().results.as_mut() {
            r.finish(job, outcome.complete, outcome.unread);
        }
        drop(ended);
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
            stale: self.stale_in(&inner),
            phase: Some(p.phase),
            files_done: p.files_done,
            files_total: p.files_total,
            bytes_done: p.bytes_done,
            bytes_total: p.bytes_total,
        };
        Some(inner.status.clone())
    }
}

/// Ends the job, also by a panic: when it is still the current one, `running` is cleared and
/// the last status (not running) is sent, outside the lock.
struct Ended<'a> {
    state: &'a AppState,
    job: u64,
    emit: &'a (dyn Fn(StatusDto) + Sync),
}

impl Drop for Ended<'_> {
    fn drop(&mut self) {
        let status = {
            let mut inner = self.state.duplicates();
            if inner
                .running
                .as_ref()
                .is_none_or(|(job, _)| *job != self.job)
            {
                return;
            }
            inner.running = None;
            inner.status.running = false;
            inner.status.version = inner.results.as_ref().map_or(0, |r| r.version);
            inner.status.stale = self.state.stale_in(&inner);
            inner.status.clone()
        };
        (self.emit)(status);
    }
}
