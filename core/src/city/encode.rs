//! The island map on the wire (city format 3).
//!
//! All little-endian (offsets are repeated in the frontend's reader): the 24-byte header shared
//! with the treemap (`count` = number of polygons), then `u32 format | f32 width | f32 height |
//! u32 points | u32 nodes | u32 edges | u32 gates | u32 build` (56 bytes in all; `build` is the
//! id the app gave this build of the island: a rebuild with other gates keeps the rev, so the
//! archipelago names the build too); the polygons, 24 bytes each: `u8 kind | u8 0 | u16 points |
//! u32 id | u32 parent | u32 0 | u64 size`; all their
//! points in polygon order, 8 bytes each: `f32 x, y`; the nodes, 8 bytes each: `f32 x, y`; the
//! edges, 12 bytes each: `u32 a | u32 b | u8 class | u8 bridge | u16 0`; the gates, 16 bytes
//! each: `u32 node | f32 dx | f32 dy | u32 first neighbour` (`u32::MAX` for none).

use super::map::Island;
use crate::treemap::header;

pub const CITY_FORMAT: u32 = 3;
pub const CITY_HEADER_LEN: usize = 56;
pub const POLY_LEN: usize = 24;
pub const POINT_LEN: usize = 8;
pub const EDGE_LEN: usize = 12;
pub const GATE_LEN: usize = 16;

/// Serializes `island` in city format 3 (see the module docs), stamped with `build`. Polygons
/// have at most `u16::MAX` points (the island never makes more).
pub fn encode_city(
    generation: u64,
    rev: u64,
    build: u32,
    approximate: bool,
    island: &Island,
) -> Vec<u8> {
    let points: usize = island.polys.iter().map(|p| p.points.len()).sum();
    let len = CITY_HEADER_LEN
        + POLY_LEN * island.polys.len()
        + POINT_LEN * (points + island.nodes.len())
        + EDGE_LEN * island.edges.len()
        + GATE_LEN * island.gates.len();
    let mut out = header(generation, rev, approximate, island.polys.len(), 0);
    out.reserve_exact(len - out.len());
    let u32s = |out: &mut Vec<u8>, vs: &[u32]| {
        for v in vs {
            out.extend_from_slice(&v.to_le_bytes());
        }
    };
    u32s(&mut out, &[CITY_FORMAT]);
    out.extend_from_slice(&island.width.to_le_bytes());
    out.extend_from_slice(&island.height.to_le_bytes());
    let counts = [
        points,
        island.nodes.len(),
        island.edges.len(),
        island.gates.len(),
    ];
    u32s(&mut out, &counts.map(|c| c as u32));
    u32s(&mut out, &[build]);
    for p in &island.polys {
        out.extend_from_slice(&[p.kind as u8, 0]);
        out.extend_from_slice(&(p.points.len() as u16).to_le_bytes());
        u32s(&mut out, &[p.id, p.parent, 0]);
        out.extend_from_slice(&p.size.to_le_bytes());
    }
    let all = island.polys.iter().flat_map(|p| &p.points);
    for xy in all.chain(&island.nodes) {
        out.extend_from_slice(&xy[0].to_le_bytes());
        out.extend_from_slice(&xy[1].to_le_bytes());
    }
    for e in &island.edges {
        u32s(&mut out, &[e.a, e.b]);
        out.extend_from_slice(&[e.class as u8, u8::from(e.bridge), 0, 0]);
    }
    for g in &island.gates {
        u32s(&mut out, &[g.node]);
        out.extend_from_slice(&g.dir[0].to_le_bytes());
        out.extend_from_slice(&g.dir[1].to_le_bytes());
        u32s(
            &mut out,
            &[g.neighbours.first().copied().unwrap_or(u32::MAX)],
        );
    }
    out
}

#[cfg(test)]
#[path = "encode_tests.rs"]
mod tests;
