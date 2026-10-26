//! The locks of the writes. A root's lock covers every write of its saved scan and every change
//! of its tree; a volume's lock is its turn: the removals of one volume go one after another,
//! and the result of a scan of the volume waits for them. Every write also holds `busy` for
//! reading, the exit gate (see `exit.rs`).
//!
//! Order, always: volume → root → `busy`. Who holds `busy` waits for no other tokio lock. A
//! request that needs several volumes (a batch of duplicates) takes its places in all their
//! queues in one step (`reserve_turns`), so two batches queue on their shared volumes in one
//! order and never wait for each other in a cycle; then its roots in ascending order.

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
    /// Held while a batch takes its places in the queues of its volumes (`reserve_turns`).
    reserving: Mutex<()>,
}

fn lock_of(locks: &LockMap, key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut locks = locks.lock().unwrap_or_else(PoisonError::into_inner);
    locks.entry(key.to_owned()).or_default().clone()
}

/// A write of roots: hold it until the saved scans are written. Fields drop in their order,
/// the reverse of the order they were taken in.
pub struct WriteGuard {
    #[expect(dead_code, reason = "held until dropped")]
    busy: OwnedRwLockReadGuard<()>,
    #[expect(dead_code, reason = "held until dropped")]
    root: Vec<OwnedMutexGuard<()>>,
    #[expect(dead_code, reason = "held until dropped")]
    volume: Vec<OwnedMutexGuard<()>>,
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

    /// The volume of `root` if it was asked already; never asks the system.
    pub(crate) fn known_volume(&self, root: &str) -> Option<String> {
        let known = self.0.locks.volume_of_root.lock();
        known
            .unwrap_or_else(PoisonError::into_inner)
            .get(root)
            .cloned()
    }

    /// The turn of `volume`. Its place in the queue is taken when the future is first polled.
    pub fn volume_turn(
        &self,
        volume: &str,
    ) -> impl Future<Output = OwnedMutexGuard<()>> + Send + 'static {
        lock_of(&self.0.locks.volumes, volume).lock_owned()
    }

    /// The places of a batch in the queues of `volumes`, each volume once, taken in one step:
    /// every turn is polled once (which queues it) while `reserving` is held, so batches queue
    /// on their shared volumes in one order. Sorted only so the order is the same every time.
    pub fn reserve_turns(&self, volumes: &[String]) -> Vec<Turn> {
        let mut volumes: Vec<&String> = volumes.iter().collect();
        volumes.sort();
        volumes.dedup();
        let reserving = &self.0.locks.reserving;
        let _reserving = reserving.lock().unwrap_or_else(PoisonError::into_inner);
        (volumes.into_iter())
            .map(|volume| Turn::reserve(self.volume_turn(volume)))
            .collect()
    }

    /// Permission to write the saved scan of `root` or change its tree: waits for the write of
    /// that root in progress, refused once the app is closing.
    pub async fn begin_write(&self, root: &str) -> Result<WriteGuard, CmdError> {
        self.begin_writes(&[root.to_owned()]).await
    }

    /// `begin_write` of several roots: each once, in ascending order, then `busy` once.
    pub async fn begin_writes(&self, roots: &[String]) -> Result<WriteGuard, CmdError> {
        self.write_after(roots, Vec::new()).await
    }

    /// `begin_write` for the result of a scan, after the removals of its volume.
    pub async fn begin_scan_write(&self, root: &str) -> Result<WriteGuard, CmdError> {
        let volume = self.volume_turn(&self.volume_of(root)).await;
        self.write_after(&[root.to_owned()], vec![volume]).await
    }

    /// Waits until no removal of the volume of `root` runs.
    pub async fn volume_idle(&self, root: &str) {
        drop(self.volume_turn(&self.volume_of(root)).await);
    }

    async fn write_after(
        &self,
        roots: &[String],
        volume: Vec<OwnedMutexGuard<()>>,
    ) -> Result<WriteGuard, CmdError> {
        let mut roots: Vec<&String> = roots.iter().collect();
        roots.sort();
        roots.dedup();
        let mut root = Vec::with_capacity(roots.len());
        for at in roots {
            root.push(lock_of(&self.0.locks.roots, at).lock_owned().await);
        }
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
    #[cfg(test)]
    pub async fn wait(self) -> OwnedMutexGuard<()> {
        match (self.got, self.wait) {
            (Some(got), _) => got,
            (None, Some(wait)) => wait.await,
            (None, None) => unreachable!("a turn either waits or has come"),
        }
    }
}

/// Waits for all `turns` together (each has its place already, see `AppState::reserve_turns`).
/// Each time one comes `stopped` is asked: then every turn is let go and `None` returned.
// ponytail: the wait for a turn that has not come is not interrupted by a stop; wake it with a
// `Notify` in the stop if that delay shows.
pub async fn wait_turns(
    mut turns: Vec<Turn>,
    stopped: impl Fn() -> bool,
) -> Option<Vec<OwnedMutexGuard<()>>> {
    let go = std::future::poll_fn(|cx| {
        let mut all = true;
        for turn in &mut turns {
            if let Some(wait) = &mut turn.wait
                && let Poll::Ready(got) = wait.as_mut().poll(cx)
            {
                turn.got = Some(got);
                turn.wait = None;
            }
            all &= turn.got.is_some();
        }
        if stopped() {
            Poll::Ready(false)
        } else if all {
            Poll::Ready(true)
        } else {
            Poll::Pending
        }
    })
    .await;
    go.then(|| turns.into_iter().filter_map(|turn| turn.got).collect())
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
