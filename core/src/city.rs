//! Island city layout: raster tools and the vector map built on top of them.

mod archipelago;
mod bends;
mod blocks;
mod bridges;
mod canal;
mod chamfer;
mod chart;
mod coast;
mod empty;
mod encode;
mod gates;
mod graph;
mod grid;
mod highways;
mod island;
mod land;
mod landing;
mod lanes;
mod lattice;
mod lots;
mod map;
mod merge;
mod net;
mod outline;
mod path;
mod plan;
mod plots;
mod rehome;
mod ring;
mod rng;
mod road;
mod runs;
mod seaway;
mod shift;
mod shore;
mod simple;
mod smooth;
mod smooth_graph;
mod span;
mod split;
mod streets;
#[cfg(test)]
mod test_sets;
mod trim;
mod trunk;
mod vector;
mod voronoi;
mod widths;
mod world;

pub use archipelago::{bearings, place, place_on_rays, settled};
pub use encode::{
    CITY_FORMAT, CITY_HEADER_LEN, EDGE_LEN, GATE_LEN, POINT_LEN, POLY_LEN, encode_city,
};
pub use graph::Edge;
pub use island::island;
pub use map::{Gate, Island, Poly, PolyKind, Stats};
pub use plan::{Folder, IslandInput, built_area, empty_ratio, island_summary, summary};
pub use road::{RoadClass, road_width};
pub use span::{Bridge, bridges};
pub use world::directions;

/// Raster cell size in metres.
pub const CELL: f32 = 1.5;
