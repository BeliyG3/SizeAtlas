//! The readers of a search: a pool of threads on each volume, and the pace of progress events.

use std::panic;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use super::DiskKind;

/// At most one progress event this often.
pub(crate) const PACE: Duration = Duration::from_millis(150);

/// Lets the first event through at once, then one per [`PACE`].
#[derive(Default)]
pub(crate) struct Pacer {
    last: Option<Instant>,
}

impl Pacer {
    pub(crate) fn due(&mut self, now: Instant) -> bool {
        let due = self
            .last
            .is_none_or(|last| now.saturating_duration_since(last) >= PACE);
        if due {
            self.last = Some(now);
        }
        due
    }
}

/// Where a job reads: the index of its volume, and its `(root, node)` order on that volume.
pub(crate) type Place = (u16, (u16, u32));

/// Runs `work` on every job: `disk.threads()` jobs at once on each volume of `disks`, every
/// volume at the same time; the jobs of a volume start in their `(root, node)` order. Once
/// `cancel` is set no job starts, and the jobs not started give `None`.
pub(crate) fn run<T: Sync, R: Send>(
    jobs: &[T],
    place: impl Fn(&T) -> Place,
    disks: &[DiskKind],
    cancel: &AtomicBool,
    work: impl Fn(&T) -> R + Sync,
) -> Vec<Option<R>> {
    let mut queues: Vec<Vec<usize>> = vec![Vec::new(); disks.len()];
    for (i, job) in jobs.iter().enumerate() {
        queues[usize::from(place(job).0)].push(i);
    }
    for queue in &mut queues {
        queue.sort_by_key(|&i| place(&jobs[i]).1);
    }
    let next: Vec<AtomicUsize> = queues.iter().map(|_| AtomicUsize::new(0)).collect();
    let mut out: Vec<Option<R>> = jobs.iter().map(|_| None).collect();
    let work = &work;
    thread::scope(|s| {
        let mut readers = Vec::new();
        for ((queue, next), disk) in queues.iter().zip(&next).zip(disks) {
            for _ in 0..disk.threads().min(queue.len()) {
                readers.push(s.spawn(move || {
                    let mut done = Vec::new();
                    while !cancel.load(Ordering::Relaxed) {
                        let Some(&i) = queue.get(next.fetch_add(1, Ordering::Relaxed)) else {
                            break;
                        };
                        done.push((i, work(&jobs[i])));
                    }
                    done
                }));
            }
        }
        for reader in readers {
            for (i, r) in reader.join().unwrap_or_else(|e| panic::resume_unwind(e)) {
                out[i] = Some(r);
            }
        }
    });
    out
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::Pacer;
    use crate::duplicates::DiskKind;

    #[test]
    fn pacer_lets_one_progress_per_150_ms() {
        let mut pacer = Pacer::default();
        let t0 = Instant::now();
        assert!(pacer.due(t0));
        assert!(!pacer.due(t0 + Duration::from_millis(100)));
        assert!(pacer.due(t0 + Duration::from_millis(150)));
    }

    #[test]
    fn ssd_gets_four_threads() {
        assert_eq!(DiskKind::Ssd.threads(), 4);
        assert_eq!(DiskKind::Hdd.threads(), 1);
        assert_eq!(DiskKind::Unknown.threads(), 1);
    }
}
