//! The locks of the writes. A root's lock covers every write of its saved scan and every change
//! of its tree; a volume's lock is its turn: the removals of one volume go one after another,
//! and the result of a scan of the volume waits for them. Every write also holds `busy` for
//! reading, the exit gate (see `exit.rs`).
//!
//! Order, always: volume → root → `busy`. Who holds `busy` waits for no other tokio lock.

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::task::{Context, Poll, Waker};

use tokio::sync::{OwnedMutexGuard, OwnedRwLockReadGuard};

use crate::error::CmdError;
use crate::state::AppState;

/// The volume of a root (see `sizeatlas_core::volume_key`).
pub type VolumeFn = Arc<dyn Fn(&Path) -> String + Send + Sync>;

type LockMap = Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>;

/// The volume key of the root, or the root itself when the volume cannot be told: the root
/// then has a turn of its own.
pub fn default_volume_of() -> VolumeFn {
    Arc::new(|root| sizeatlas_core::volume_key(root).unwrap_or_else(|| root.display().to_string()))
}

/// The locks of the roots and of the volumes, made on first use.
// ponytail: entries are never removed; a session has a handful of roots and volumes.
#[derive(Default)]
pub struct Locks {
    roots: LockMap,
    volumes: LockMap,
    /// The volume of each root, asked once per session.
    volume_of_root: Mutex<HashMap<String, String>>,
}

fn lock_of(locks: &LockMap, key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut locks = locks.lock().unwrap_or_else(PoisonError::into_inner);
    locks.entry(key.to_owned()).or_default().clone()
}

/// A write of one root: hold it until the saved scan is written. Fields drop in their order,
/// the reverse of the order they were taken in.
pub struct WriteGuard {
    #[expect(dead_code, reason = "held until dropped")]
    busy: OwnedRwLockReadGuard<()>,
    #[expect(dead_code, reason = "held until dropped")]
    root: OwnedMutexGuard<()>,
    #[expect(dead_code, reason = "held until dropped")]
    volume: Option<OwnedMutexGuard<()>>,
}

impl AppState {
    /// The volume of `root`, asked once per session.
    pub fn volume_of(&self, root: &str) -> String {
        let known = &self.0.locks.volume_of_root;
        if let Some(volume) = known
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(root)
        {
            return volume.clone();
        }
        // Outside the lock: asking the system may take a while (a network share).
        // ponytail: once per root, but on the async runtime, so a slow first answer of a network
        // share holds a runtime thread; ask in `spawn_blocking` if that shows.
        let volume = (self.0.volume_of)(Path::new(root));
        let mut known = known.lock().unwrap_or_else(PoisonError::into_inner);
        known.entry(root.to_owned()).or_insert(volume).clone()
    }

    /// The turn of `volume`. Its place in the queue is taken when the future is first polled.
    pub fn volume_turn(
        &self,
        volume: &str,
    ) -> impl Future<Output = OwnedMutexGuard<()>> + Send + 'static {
        lock_of(&self.0.locks.volumes, volume).lock_owned()
    }

    /// Permission to write the saved scan of `root` or change its tree: waits for the write of
    /// that root in progress, refused once the app is closing.
    pub async fn begin_write(&self, root: &str) -> Result<WriteGuard, CmdError> {
        self.write_after(root, None).await
    }

    /// `begin_write` for the result of a scan, after the removals of its volume.
    pub async fn begin_scan_write(&self, root: &str) -> Result<WriteGuard, CmdError> {
        let volume = self.volume_turn(&self.volume_of(root)).await;
        self.write_after(root, Some(volume)).await
    }

    /// Waits until no removal of the volume of `root` runs.
    pub async fn volume_idle(&self, root: &str) {
        drop(self.volume_turn(&self.volume_of(root)).await);
    }

    async fn write_after(
        &self,
        root: &str,
        volume: Option<OwnedMutexGuard<()>>,
    ) -> Result<WriteGuard, CmdError> {
        let root = lock_of(&self.0.locks.roots, root).lock_owned().await;
        let busy = self.0.busy.clone().read_owned().await;
        // Read with `busy` held: `on_exit_request` holds it for writing while it allows the exit.
        if self.closing() {
            return Err(CmdError::Busy);
        }
        Ok(WriteGuard { busy, root, volume })
    }
}

/// A place kept in the queue of a volume while the request is still being prepared.
pub struct Turn {
    wait: Option<Pin<Box<dyn Future<Output = OwnedMutexGuard<()>> + Send>>>,
    got: Option<OwnedMutexGuard<()>>,
}

impl Turn {
    /// Takes the place now: polls `turn` once, which queues it.
    pub fn reserve(turn: impl Future<Output = OwnedMutexGuard<()>> + Send + 'static) -> Turn {
        let mut wait: Pin<Box<dyn Future<Output = _> + Send>> = Box::pin(turn);
        match wait.as_mut().poll(&mut Context::from_waker(Waker::noop())) {
            Poll::Ready(got) => Turn {
                wait: None,
                got: Some(got),
            },
            Poll::Pending => Turn {
                wait: Some(wait),
                got: None,
            },
        }
    }

    /// Waits for the turn.
    pub async fn wait(self) -> OwnedMutexGuard<()> {
        match (self.got, self.wait) {
            (Some(got), _) => got,
            (None, Some(wait)) => wait.await,
            (None, None) => unreachable!("a turn either waits or has come"),
        }
    }
}

/// Polls `f` once: `None` while it waits.
#[cfg(test)]
pub fn ready<F: Future>(f: F) -> Option<F::Output> {
    let mut f = std::pin::pin!(f);
    match f.as_mut().poll(&mut Context::from_waker(Waker::noop())) {
        Poll::Ready(out) => Some(out),
        Poll::Pending => None,
    }
}

#[cfg(test)]
mod tests;
