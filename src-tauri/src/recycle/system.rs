//! The trash of the system, and whether an item would go there rather than be deleted for good.

use std::panic::{self, AssertUnwindSafe};
use std::path::Path;

use crate::error::CmdError;
use crate::state::TrashItem;

/// `NoTrash` unless `can_recycle` (`sizeatlas_core::can_recycle`) says the item goes to the trash
/// rather than being deleted for good, judged by the larger of its size on disk and its length.
pub fn bin_takes(
    item: &TrashItem,
    can_recycle: impl Fn(&Path, u64) -> bool,
) -> Result<(), CmdError> {
    if can_recycle(&item.path, item.size.max(item.len)) {
        Ok(())
    } else {
        Err(CmdError::NoTrash)
    }
}

/// The trash of the OS: the Recycle Bin on Windows, the Trash on macOS (through NSFileManager,
/// which needs no permission to control Finder), the freedesktop trash on Linux. A panic in the
/// crate (it unwraps some system calls) is an error of this item, not of the app.
// ponytail: between `check` and this call the item can still change (the crate takes a path);
// the gap is short and the trash can be undone. See README, "Moving to the trash". The same
// short gap after `recheck` remains for `purge::delete`, which cannot be undone; closing it
// needs handle-based deletes.
pub fn move_to_trash(path: &Path) -> Result<(), String> {
    panic::catch_unwind(AssertUnwindSafe(|| {
        #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
        let mut context = trash::TrashContext::default();
        #[cfg(target_os = "macos")]
        {
            use trash::macos::{DeleteMethod, TrashContextExtMacos};
            context.set_delete_method(DeleteMethod::NsFileManager);
        }
        context.delete(path).map_err(|e| e.to_string())
    }))
    .unwrap_or_else(|_| Err("the trash of the system failed".to_owned()))
}
