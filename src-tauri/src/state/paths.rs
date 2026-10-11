//! Real paths of nodes, for the actions that hand them to the system (reveal, copy, trash).

use std::path::PathBuf;

use super::AppState;
use crate::error::CmdError;

impl AppState {
    /// Real path of a node; refused when a name on the way was not valid Unicode.
    pub fn exact_path(&self, generation: u64, id: u32) -> Result<PathBuf, CmdError> {
        self.with_live(generation, id, |tree| {
            (!tree.has_lossy_path(id)).then(|| tree.path(id))
        })?
        .ok_or(CmdError::LossyName)
    }

    /// Real paths of `ids` in their order; refused as a whole (`LossyName`) if one is not exact.
    pub fn exact_paths(&self, generation: u64, ids: &[u32]) -> Result<Vec<PathBuf>, CmdError> {
        ids.iter()
            .map(|&id| self.exact_path(generation, id))
            .collect()
    }
}

#[cfg(test)]
mod tests;
