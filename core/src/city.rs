//! Island city layout: raster tools and the vector map built on top of them.

// Used by the island layout from Task 6.
#![allow(dead_code)]

mod grid;
mod land;
mod path;
mod plan;
mod rng;
mod voronoi;

pub use plan::{Folder, IslandInput, built_area, empty_ratio, summary};

/// Raster cell size in metres.
pub const CELL: f32 = 1.5;
