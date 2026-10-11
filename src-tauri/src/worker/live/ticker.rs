//! Live tree updates must not delay the independent 100 ms status ticker.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub(super) struct LiveTicker(Arc<AtomicBool>);

impl LiveTicker {
    pub fn start(tick: impl Fn() + Send + 'static) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_millis(100));
                if stopped.load(Ordering::Relaxed) {
                    break;
                }
                tick();
            }
        });
        Self(stop)
    }
}

impl Drop for LiveTicker {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}
