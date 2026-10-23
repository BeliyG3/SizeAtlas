//! The Unix-only refusals of the re-check: other users' items and special files, on real files
//! inside `tempfile` folders.

use std::ffi::CString;
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::net::UnixListener;

use super::recheck_tests::{check, file, now, temp};
use super::{Reason, Refusal};
use crate::platform::foreign_to;

#[test]
fn a_fifo_in_a_row_is_refused() {
    let (_dir, root) = temp();
    let row = root.join("node_modules");
    file(&row.join("index.js"));
    assert!(matches!(check(&row, Reason::NodeModules, now()), Ok(())));
    let fifo = CString::new(row.join("pipe").as_os_str().as_bytes()).unwrap();
    // SAFETY: `fifo` is a NUL-terminated path.
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    assert!(matches!(
        check(&row, Reason::NodeModules, now()),
        Err(Refusal::Protected)
    ));
}

#[test]
fn a_socket_in_a_row_is_refused() {
    let (_dir, root) = temp();
    let row = root.join("node_modules");
    fs::create_dir(&row).unwrap();
    let Ok(_socket) = UnixListener::bind(row.join("s")) else {
        eprintln!("skipped: cannot bind a socket here (path too long?)");
        return;
    };
    assert!(matches!(
        check(&row, Reason::NodeModules, now()),
        Err(Refusal::Protected)
    ));
}

/// Files of another user cannot be made without root, so the decision is tested with the own
/// file seen by another user.
#[test]
fn an_item_of_another_user_is_foreign() {
    let (_dir, root) = temp();
    let path = root.join("a.txt");
    file(&path);
    let meta = fs::symlink_metadata(&path).unwrap();
    // SAFETY: `geteuid` has no preconditions and cannot fail.
    let me = unsafe { libc::geteuid() };
    assert!(!foreign_to(&meta, me));
    assert!(foreign_to(&meta, me.wrapping_add(1)));
}
