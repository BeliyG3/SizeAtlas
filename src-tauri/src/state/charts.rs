//! Chart and side panel data for the open tree.

use sizeatlas_core::categories::Category;
use sizeatlas_core::treemap;

use super::AppState;
use crate::dto::{TypeStatDto, TypeStatsDto};
use crate::error::CmdError;

/// Largest treemap side accepted, so a bogus size cannot ask for a huge layout.
const MAX_SIDE: f32 = 16_384.0;

impl AppState {
    /// Space by file type below `id`; categories without files are left out, largest first.
    pub fn type_stats(&self, generation: u64, id: u32) -> Result<TypeStatsDto, CmdError> {
        self.with_live(generation, id, |tree| {
            let mut items: Vec<TypeStatDto> = Category::ALL
                .iter()
                .zip(tree.type_stats(id))
                .filter(|(_, stat)| stat.files > 0)
                .map(|(&category, stat)| TypeStatDto {
                    category: category as u8,
                    files: stat.files,
                    size: stat.size,
                })
                .collect();
            items.sort_by(|a, b| b.size.cmp(&a.size).then(a.category.cmp(&b.category)));
            TypeStatsDto {
                generation,
                rev: tree.rev,
                items,
            }
        })
    }

    /// Encoded treemap of `id` for a `width × height` canvas (see `sizeatlas_core::treemap`).
    pub fn treemap(
        &self,
        generation: u64,
        id: u32,
        width: f32,
        height: f32,
    ) -> Result<Vec<u8>, CmdError> {
        let side = |v: f32| if v.is_finite() { v.min(MAX_SIDE) } else { 0.0 };
        self.with_live(generation, id, |tree| {
            let rects = treemap::layout(tree, id, side(width), side(height), treemap::MAX_RECTS);
            treemap::encode(generation, tree.rev, tree.approximate, &rects)
        })
    }

    /// Encoded city of the whole root `generation`: a fixed-size layout with node sizes
    /// (see `sizeatlas_core::treemap`).
    pub fn city(&self, generation: u64) -> Result<Vec<u8>, CmdError> {
        self.with_live(generation, 0, |tree| {
            let rects = treemap::layout(
                tree,
                0,
                treemap::CITY_FIELD,
                treemap::CITY_FIELD,
                treemap::MAX_RECTS,
            );
            treemap::encode_city(generation, tree.rev, tree.approximate, &rects, tree)
        })
    }
}
