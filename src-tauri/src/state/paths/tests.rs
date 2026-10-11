use std::fs;
use std::sync::atomic::AtomicBool;

use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};

use crate::error::CmdError;
use crate::state::AppState;

#[test]
fn exact_paths_keep_their_order_and_refuse_a_lossy_one() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("small.txt"), b"x").unwrap();
    let ScanOutcome::Done(mut tree) =
        scan(dir.path(), &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    let sub = tree.children(0).find(|&c| tree.node(c).is_dir()).unwrap();
    let small = tree.children(0).find(|&c| !tree.node(c).is_dir()).unwrap();
    let canonical = dunce::canonicalize(dir.path()).unwrap();
    let state = AppState::default();
    let generation = state.install_tree(tree.clone());
    assert_eq!(
        state.exact_paths(generation, &[sub, small]).unwrap(),
        [canonical.join("sub"), canonical.join("small.txt")]
    );
    tree.mark_lossy_for_test(sub);
    let generation = state.install_tree(tree);
    assert_eq!(
        state.exact_paths(generation, &[small, sub]),
        Err(CmdError::LossyName)
    );
}
