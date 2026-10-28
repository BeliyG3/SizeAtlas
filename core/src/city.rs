//! Island city layout: raster tools and the vector map built on top of them.

// Used by the island layout from Task 6.
#![allow(dead_code)]

mod blocks;
mod canal;
mod empty;
mod gates;
mod grid;
mod highways;
mod land;
mod lots;
mod net;
mod path;
mod plan;
mod plots;
mod ring;
mod rng;
mod shore;
mod voronoi;
mod widths;
mod world;

pub use plan::{Folder, IslandInput, built_area, empty_ratio, summary};
pub use world::directions;

/// Raster cell size in metres.
pub const CELL: f32 = 1.5;
