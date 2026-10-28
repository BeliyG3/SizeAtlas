//! The canal: an axis across the island, straight, 45° and straight again, out to sea at both ends.

use super::CELL;
use super::grid::Grid;
use super::path::point_segment;
use super::rng::Rng;
use std::f32::consts::FRAC_1_SQRT_2;

/// Width of the canal's water, metres.
pub(crate) const CANAL_WIDTH: f32 = 26.0;
/// Only an island with more land than this gets a canal, m².
const MIN_LAND: f32 = 300_000.0;
/// Share of the big islands that get a canal.
const CHANCE: f32 = 1.0 / 3.0;
/// The axis runs on this far past the land at both ends, metres.
const BEYOND: f32 = 400.0;

/// The canal's axis in field metres, or `None` for most islands (a third of those with more than
/// `MIN_LAND` of land get one, by `rng`). It runs along one of 0/45/90/135°: a leg offset from
/// `core` by 10–28% of the land's width across it, a 45° jog of 12–25% of that width in the middle,
/// and a second leg out the other side, both legs `BEYOND` metres past the land.
pub(crate) fn canal(land: &Grid<bool>, core: [f32; 2], rng: &mut Rng) -> Option<Vec<[f32; 2]>> {
    let lucky = rng.unit() < CHANCE;
    let cells = land.data.iter().filter(|&&l| l).count();
    if !lucky || cells as f32 * CELL * CELL <= MIN_LAND {
        return None;
    }
    let s = FRAC_1_SQRT_2;
    let u = [[1.0, 0.0], [s, s], [0.0, 1.0], [-s, s]][((rng.unit() * 4.0) as usize).min(3)];
    let across = [-u[1], u[0]];
    let (mut lo, mut hi) = ([f32::INFINITY; 2], [f32::NEG_INFINITY; 2]);
    for (i, _) in land.data.iter().enumerate().filter(|(_, l)| **l) {
        let p = [
            ((i % land.w) as f32 + 0.5) * CELL - core[0],
            ((i / land.w) as f32 + 0.5) * CELL - core[1],
        ];
        let q = [
            p[0] * u[0] + p[1] * u[1],
            p[0] * across[0] + p[1] * across[1],
        ];
        for a in 0..2 {
            lo[a] = lo[a].min(q[a]);
            hi[a] = hi[a].max(q[a]);
        }
    }
    let width = hi[1] - lo[1];
    // A leg that would miss the land's span across turns to the other side of the core.
    let inside = |o: f32| o > lo[1] && o < hi[1];
    let sign = |rng: &mut Rng| if rng.unit() < 0.5 { -1.0 } else { 1.0 };
    let mut o1 = rng.range(0.1, 0.28) * width * sign(rng);
    if !inside(o1) {
        o1 = -o1;
    }
    let jog = rng.range(0.12, 0.25) * width * sign(rng);
    let o2 = if inside(o1 + jog) { o1 + jog } else { o1 - jog };
    let (mid, half) = (0.5 * (lo[0] + hi[0]), 0.5 * (o2 - o1).abs());
    let frame = [
        [lo[0] - BEYOND, o1],
        [mid - half, o1],
        [mid + half, o2],
        [hi[0] + BEYOND, o2],
    ];
    Some(
        frame
            .iter()
            .map(|&[a, b]| {
                [
                    core[0] + a * u[0] + b * across[0],
                    core[1] + a * u[1] + b * across[1],
                ]
            })
            .collect(),
    )
}

/// The canal's water on the land's field of `w` × `h` cells: the cells whose centre lies closer
/// than half the canal's width to its axis.
pub(crate) fn water(canal: &[[f32; 2]], w: usize, h: usize) -> Grid<bool> {
    near(canal, w, h, CELL, [0.0; 2], 0.5 * CANAL_WIDTH)
}

/// The cells of a `w` × `h` grid of `cell` metres starting at `origin` whose centre lies closer
/// than `r` metres to the polyline `line`.
pub(crate) fn near(
    line: &[[f32; 2]],
    w: usize,
    h: usize,
    cell: f32,
    origin: [f32; 2],
    r: f32,
) -> Grid<bool> {
    let mut out = Grid::new(w, h, false);
    let span = |a: f32, b: f32, o: f32, n: usize| {
        let first = ((a.min(b) - r - o) / cell).floor().max(0.0) as usize;
        let last = (((a.max(b) + r - o) / cell).ceil().max(0.0) as usize).min(n);
        first..last
    };
    for seg in line.windows(2) {
        let [a, b] = [seg[0], seg[1]];
        for y in span(a[1], b[1], origin[1], h) {
            for x in span(a[0], b[0], origin[0], w) {
                let p = [
                    origin[0] + (x as f32 + 0.5) * cell,
                    origin[1] + (y as f32 + 0.5) * cell,
                ];
                if point_segment(p, a, b) < r {
                    out.set(x, y, true);
                }
            }
        }
    }
    out
}

/// `line` with both end segments carried on `by` metres further out.
pub(crate) fn extend(line: &[[f32; 2]], by: f32) -> Vec<[f32; 2]> {
    let mut out = line.to_vec();
    let n = out.len();
    if n < 2 {
        return out;
    }
    let push = |end: [f32; 2], from: [f32; 2]| {
        let d = [end[0] - from[0], end[1] - from[1]];
        let len = d[0].hypot(d[1]).max(f32::MIN_POSITIVE);
        [end[0] + d[0] / len * by, end[1] + d[1] / len * by]
    };
    out[0] = push(line[0], line[1]);
    out[n - 1] = push(line[n - 1], line[n - 2]);
    out
}

#[cfg(test)]
#[path = "canal_tests.rs"]
mod tests;
