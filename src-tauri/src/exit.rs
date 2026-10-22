//! Closing stops the scans and waits only for a saved scan that is being written, deleted or
//! read (an open drops what it read once closing started).
//!
//! RUNNING → (close, nothing written) → ALLOWED
//! RUNNING → (close during a write) → WAITING → (write finished) → ALLOWED → app.exit
//! Either way the running walk is cancelled and the waiting roots are dropped; a walk that has
//! finished and holds a write is still installed and saved. In WAITING every further close
//! request is refused; once not RUNNING, no scan is queued and no write starts.

use std::sync::atomic::Ordering;

use tokio::sync::OwnedMutexGuard;

use crate::error::CmdError;
use crate::state::AppState;

pub const RUNNING: u8 = 0;
pub const WAITING: u8 = 1;
pub const ALLOWED: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitDecision {
    Allow,
    Prevent,
    /// Prevent now, wait for `busy`, then exit.
    PreventAndWait,
}

impl AppState {
    /// Permission to write or delete a saved scan: waits for the write in progress, refused
    /// once the app is closing. Hold the guard until the file is written.
    pub async fn begin_write(&self) -> Result<OwnedMutexGuard<()>, CmdError> {
        let write = self.0.busy.clone().lock_owned().await;
        // Read with `busy` held: `on_exit_request` holds it while it allows the exit.
        if self.0.exit.load(Ordering::Acquire) != RUNNING {
            return Err(CmdError::Busy);
        }
        Ok(write)
    }

    /// The app started closing: long work stops before its next step.
    pub fn closing(&self) -> bool {
        self.0.exit.load(Ordering::Acquire) != RUNNING
    }

    /// Waits until no saved scan is being written and no trash runs: both hold `busy`.
    pub async fn writes_done(&self) {
        drop(self.0.busy.lock().await);
    }

    /// Decides what to do with a close or exit request. Runs under the queue lock, which
    /// `enqueue` also takes, so no scan is queued between the check and the decision.
    pub fn on_exit_request(&self) -> ExitDecision {
        let mut scans = self.scans();
        match self.0.exit.load(Ordering::Acquire) {
            ALLOWED => ExitDecision::Allow,
            WAITING => ExitDecision::Prevent,
            _ => {
                scans.stop_all();
                match self.0.busy.try_lock() {
                    Ok(_idle) => {
                        // Still holding `busy`: no write can start before ALLOWED is visible.
                        self.0.exit.store(ALLOWED, Ordering::Release);
                        ExitDecision::Allow
                    }
                    Err(_) => {
                        self.0.exit.store(WAITING, Ordering::Release);
                        ExitDecision::PreventAndWait
                    }
                }
            }
        }
    }

    pub async fn wait_until_idle(&self) {
        let _idle = self.0.busy.lock().await;
        self.0.exit.store(ALLOWED, Ordering::Release);
    }

    /// Last resort for `RunEvent::Exit` when the exit bypassed `on_exit_request`.
    pub fn block_until_idle(&self) {
        if self.0.exit.load(Ordering::Acquire) != ALLOWED {
            self.scans().stop_all();
            let _idle = self.0.busy.blocking_lock();
        }
    }
}

#[cfg(test)]
mod tests;
