//! Island city layout: raster tools and the vector map built on top of them.

mod blocks;
mod bridges;
mod canal;
mod empty;
mod encode;
mod gates;
mod graph;
mod grid;
mod highways;
mod island;
mod land;
mod lattice;
mod lots;
mod map;
mod merge;
mod net;
mod outline;
mod path;
mod plan;
mod plots;
mod ring;
mod rng;
mod road;
mod shore;
mod split;
mod streets;
mod trim;
mod vector;
mod voronoi;
mod widths;
mod world;

pub use encode::{
    CITY_FORMAT, CITY_HEADER_LEN, EDGE_LEN, GATE_LEN, POINT_LEN, POLY_LEN, encode_city,
};
pub use graph::Edge;
pub use island::island;
pub use map::{Gate, Island, Poly, PolyKind, Stats};
pub use plan::{Folder, IslandInput, built_area, empty_ratio, summary};
pub use road::{RoadClass, road_width};
pub use world::directions;

/// Raster cell size in metres.
pub const CELL: f32 = 1.5;
