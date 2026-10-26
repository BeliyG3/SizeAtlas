//! The roots of a search: the disk each lies on and the volume its trash queues on.

use std::path::PathBuf;
use std::sync::Arc;

use sizeatlas_core::duplicates::DiskKind;

use super::Emit;
use super::roots::{disk_of, pick};
use super::tests::{counting, open_pair};
use crate::state::AppState;

/// `p` as written on Windows; elsewhere `C:\x` becomes `/C/x`.
fn at(p: &str) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(p)
    } else {
        PathBuf::from(format!("/{}", p.replace(":\\", "/").replace('\\', "/")))
    }
}

#[test]
fn disk_of_picks_the_longest_mount() {
    let mounts = [
        (at("C:\\"), DiskKind::Ssd),
        (at("C:\\mnt\\hdd"), DiskKind::Hdd),
    ];
    assert_eq!(disk_of(&at("C:\\mnt\\hdd\\x"), &mounts), DiskKind::Hdd);
    assert_eq!(disk_of(&at("C:\\mnt\\other"), &mounts), DiskKind::Ssd);
    assert_eq!(disk_of(&at("Z:\\x"), &mounts), DiskKind::Unknown);
}

#[test]
fn disk_of_compares_components_not_strings() {
    let mounts = [(at("C:\\mnt"), DiskKind::Hdd)];
    assert_ne!(disk_of(&at("C:\\mnt2\\x"), &mounts), DiskKind::Hdd);
    assert_eq!(disk_of(&at("C:\\mnt\\x"), &mounts), DiskKind::Hdd);
}

#[test]
fn picked_roots_carry_the_volume_of_the_trash_queue() {
    let (context, _) = counting();
    let state = AppState::with_context_and_volumes(
        context,
        Arc::new(|root| {
            let name = root.file_name().unwrap().to_string_lossy();
            name.split('-').next().unwrap().to_owned()
        }),
    );
    let (_dir, root, generation) = open_pair(&state, "v7-");
    let (picked, skipped) = pick(&state);
    assert!(skipped.is_empty());
    assert_eq!(picked.len(), 1);
    assert_eq!(picked[0].root, root);
    assert_eq!(picked[0].generation, generation);
    assert_eq!(picked[0].volume, "v7");
    assert_eq!(picked[0].volume, state.volume_of(&root));
    drop(picked);
    let emit: Emit = Arc::new(|_| {});
    let (_, handle) = state.find_duplicates(String::new(), false, emit).unwrap();
    handle.join().unwrap();
    assert_eq!(state.0.duplicates.inner.lock().unwrap().volumes, ["v7"]);
}
