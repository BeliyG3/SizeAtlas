//! Thumbnails of the copies in a result: the bytes of an image file of an open tree, for an
//! `<img>` of the webview. An empty answer means "no thumbnail" (the UI draws the icon of the
//! category). Nothing is read that is not a live file of the tree, that the webview does not
//! show, that is larger than [`MAX_THUMB_BYTES`], that is in the cloud, or whose header says
//! it has more than [`MAX_PIXELS`] (a decompression bomb, whatever its name says).

use std::io::Read;

use sizeatlas_core::duplicates::hash::open_checked;
use sizeatlas_core::image_size::{MAX_PIXELS, MAX_THUMB_BYTES, THUMB_EXTS, has_signature, pixels};
use sizeatlas_core::tree::flags;

use crate::error::CmdError;
use crate::state::AppState;

/// Read first, to refuse a bomb by its header; a header longer than this is judged after the
/// whole file is read.
const HEAD: u64 = 64 << 10;

/// Extensions that must hold a raster image the header of which can be read; `svg`, `ico` and
/// `avif` need one only when their content starts like one.
const RASTER_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/// The file of node `id` of the root `root` with `generation`. `StaleId` for another generation
/// or root. The path is copied and the tree let go before the file is opened (`tree_mut` waits
/// for every `Arc`); the file is opened as a search opens it: not a cloud file, and the one the
/// scan saw.
pub fn thumbnail(
    state: &AppState,
    root: &str,
    generation: u64,
    id: u32,
) -> Result<Vec<u8>, CmdError> {
    let tree = state.tree(generation)?;
    if tree.name(0) != root {
        return Err(CmdError::StaleId);
    }
    let found = tree
        .get(id)
        .filter(|n| !n.is_dir() && !n.has(flags::CLOUD) && n.len <= MAX_THUMB_BYTES)
        .filter(|_| !tree.has_lossy_path(id))
        .map(|n| (tree.path(id), n.len, n.mtime));
    drop(tree);
    let Some((path, len, mtime)) = found else {
        return Ok(Vec::new());
    };
    let ext = path.extension().and_then(|e| e.to_str());
    let ext = ext.map(str::to_ascii_lowercase).unwrap_or_default();
    if !THUMB_EXTS.contains(&ext.as_str()) {
        return Ok(Vec::new());
    }
    let Ok((mut file, _, _)) = open_checked(&path, len, mtime) else {
        return Ok(Vec::new());
    };
    let mut bytes = Vec::new();
    let head = (&mut file).take(HEAD).read_to_end(&mut bytes);
    // A bomb whose header lies in the head is refused without reading the rest of the file.
    if head.is_err() || pixels(&bytes).is_some_and(|p| p > MAX_PIXELS) {
        return Ok(Vec::new());
    }
    let rest = file
        .take(MAX_THUMB_BYTES + 1 - bytes.len() as u64)
        .read_to_end(&mut bytes);
    if rest.is_err() || bytes.len() as u64 > MAX_THUMB_BYTES || !allowed(&bytes, &ext) {
        return Ok(Vec::new());
    }
    Ok(bytes)
}

/// Whether the header of `bytes` (a file named `.ext`) promises an image small enough to decode.
fn allowed(bytes: &[u8], ext: &str) -> bool {
    if has_signature(bytes) {
        return pixels(bytes).is_some_and(|p| p <= MAX_PIXELS);
    }
    !RASTER_EXTS.contains(&ext)
}
