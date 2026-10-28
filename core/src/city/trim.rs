//! Clearing the lots the roads run over.

use super::CELL;
use super::graph::Edge;
use super::grid::Grid;
use super::path::point_segment;
use super::road::{RoadClass, road_width};

/// How close a lot's cell may come to the axis of a road of class `c`, metres: half a highway's,
/// the ring's or a ramp's 16 m, half the width less 0.5 m for a street or a lane (their room is
/// kept by the lots themselves, this only catches where the axis strays).
pub(crate) fn clearance(c: RoadClass) -> f32 {
    match c {
        RoadClass::Highway | RoadClass::Ring | RoadClass::Ramp => 0.5 * road_width(c),
        RoadClass::Street | RoadClass::Lane => 0.5 * road_width(c) - 0.5,
    }
}

/// Clears (`-1`) every cell of `lot` whose square comes closer than [`clearance`] to an edge.
pub(crate) fn clear_roads(lot: &mut Grid<i32>, nodes: &[[f32; 2]], edges: &[Edge]) {
    for e in edges {
        let (a, b) = (nodes[e.a as usize], nodes[e.b as usize]);
        let r = clearance(e.class);
        let cells = |v0: f32, v1: f32, n: usize| {
            let lo = ((v0.min(v1) - r) / CELL).floor().max(0.0) as usize;
            let hi = (((v0.max(v1) + r) / CELL).ceil().max(0.0) as usize).min(n);
            lo..hi
        };
        for y in cells(a[1], b[1], lot.h) {
            for x in cells(a[0], b[0], lot.w) {
                let i = lot.idx(x, y);
                if lot.data[i] >= 0 && square_segment(x, y, a, b) < r {
                    lot.data[i] = -1;
                }
            }
        }
    }
}

/// Distance between the square of cell `(x, y)` and the segment `a`-`b`, metres.
fn square_segment(x: usize, y: usize, a: [f32; 2], b: [f32; 2]) -> f32 {
    let (x0, y0) = (x as f32 * CELL, y as f32 * CELL);
    let (x1, y1) = (x0 + CELL, y0 + CELL);
    let inside = |p: [f32; 2]| p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
    let to_square = |p: [f32; 2]| {
        (x0 - p[0])
            .max(p[0] - x1)
            .max(0.0)
            .hypot((y0 - p[1]).max(p[1] - y1).max(0.0))
    };
    let corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    if inside(a) || inside(b) || crosses(a, b, &corners) {
        return 0.0;
    }
    corners
        .iter()
        .map(|&c| point_segment(c, a, b))
        .chain([to_square(a), to_square(b)])
        .fold(f32::INFINITY, f32::min)
}

/// Whether the segment `a`-`b` crosses a side of the square with `corners`.
fn crosses(a: [f32; 2], b: [f32; 2], corners: &[[f32; 2]; 4]) -> bool {
    let cross = |o: [f32; 2], p: [f32; 2], q: [f32; 2]| {
        (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    };
    (0..4).any(|i| {
        let (c, d) = (corners[i], corners[(i + 1) % 4]);
        cross(a, b, c) * cross(a, b, d) <= 0.0 && cross(c, d, a) * cross(c, d, b) <= 0.0
    })
}
