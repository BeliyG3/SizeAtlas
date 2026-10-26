//! `find_duplicates` and the confirmation of a trash of duplicates started at once: exactly one
//! of them wins, the other is `Busy`.

use std::sync::{Arc, Barrier};
use std::thread;

use super::tests::recorder;
use super::trash;
use super::trash_fixture::{Dups, at};
use crate::error::CmdError;

#[test]
fn find_and_confirm_race_on_a_barrier() {
    let t = Dups::new();
    let (_da, a) = t.root("a", &[("a", 1), ("b", 1)]);
    t.find(false);
    for _ in 0..20 {
        let job = t.dto().job;
        let refs = t.refs(&[at(&a, "b")]);
        let barrier = Arc::new(Barrier::new(2));
        let (state, at_start) = (t.state.clone(), barrier.clone());
        let finding = thread::spawn(move || {
            at_start.wait();
            state.find_duplicates(String::new(), false, recorder().0)
        });
        let state = t.state.clone();
        let confirming = thread::spawn(move || {
            barrier.wait();
            trash::confirm(&state, 1, &refs)
        });
        match (finding.join().unwrap(), confirming.join().unwrap()) {
            (Ok((found, handle)), Err(refused)) => {
                assert_eq!(refused, CmdError::Busy);
                assert!(found > job);
                assert_eq!(t.trashing(), 0);
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
            (found, confirmed) => panic!(
                "exactly one wins: {:?} {:?}",
                found.map(|f| f.0),
                confirmed.map(|_| ())
            ),
        }
    }
}
