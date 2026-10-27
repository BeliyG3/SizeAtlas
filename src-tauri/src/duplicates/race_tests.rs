//! `find_duplicates` and the confirmation of a trash of duplicates started at once: never may a
//! search run while a trash request is registered.

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Barrier, Mutex};
use std::thread;

use super::Emit;
use super::trash;
use super::trash_fixture::{Dups, at};
use crate::error::CmdError;
use crate::recycle::fixture::HANG;

/// Statuses that wait until the sender is dropped: a job that started stays running until then.
fn held() -> (Emit, Sender<()>) {
    let (open, gate) = mpsc::channel::<()>();
    let gate = Mutex::new(gate);
    let emit: Emit = Arc::new(move |_| {
        let _ = gate.lock().unwrap().recv_timeout(HANG);
    });
    (emit, open)
}

#[test]
fn find_and_confirm_race_on_a_barrier() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("a", 1), ("b", 1)]);
    t.find(false);
    for round in 0..20 {
        let job = t.dto().job;
        let refs = t.refs(&[at(&a, "b")]);
        let (emit, open) = held();
        let barrier = Arc::new(Barrier::new(2));
        // Every other round the confirmation waits until the search has started, so a search
        // that won is seen for sure; the other rounds race.
        let (found_tx, found_rx) = mpsc::channel();
        let (state, at_start) = (t.state.clone(), barrier.clone());
        let finding = thread::spawn(move || {
            at_start.wait();
            let found = state.find_duplicates(String::new(), false, None, emit);
            let _ = found_tx.send(());
            found
        });
        let state = t.state.clone();
        let confirming = thread::spawn(move || {
            barrier.wait();
            if round % 2 == 1 {
                found_rx.recv_timeout(HANG).unwrap();
            }
            trash::confirm(&state, 1, &refs)
        });
        match (finding.join().unwrap(), confirming.join().unwrap()) {
            (Ok((found, handle)), Err(refused)) => {
                assert_eq!(refused, CmdError::Busy);
                assert!(found > job);
                assert!(t.state.duplicates_running(), "held at its first status");
                assert_eq!(t.trashing(), 0);
                drop(open);
                handle.join().unwrap();
            }
            (Err(refused), Ok(confirmed)) => {
                assert_eq!(refused, CmdError::Busy);
                assert_eq!(t.trashing(), 1);
                assert_eq!(t.dto().job, job, "no new search");
                assert!(!t.state.duplicates_running());
                drop(confirmed);
                assert_eq!(t.trashing(), 0);
            }
            // Both would be right only after the search ended, and it cannot end before `open`
            // goes: the core sends its first status before it reads anything.
            (Ok(_), Ok(_)) => panic!("a trash registered while a search runs"),
            (Err(found), Err(confirmed)) => panic!("one of them wins: {found:?} {confirmed:?}"),
        }
    }
}
