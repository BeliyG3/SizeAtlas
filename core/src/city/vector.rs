//! Tracing raster regions into octilinear polygons.

use super::CELL;
use super::grid::Grid;
use super::path::{octilinear, octilinear_inside};

/// Components smaller than this many cells are left out.
const MIN_CELLS: usize = 4;

/// How a region's outline is straightened.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Fit {
    /// Within one cell of the cell outline, on either side.
    Near,
    /// Within one cell, never outside the region's cells.
    Inside,
}

/// The outer outlines of the 4-connected components of `label` in `labels` (cells of `CELL`
/// metres from the origin), octilinear within one cell; components under 4 cells are left out.
pub(crate) fn trace(labels: &Grid<i32>, label: i32) -> Vec<Vec<[f32; 2]>> {
    outlines(labels, Some(label), CELL, [0.0; 2], Fit::Near)
        .into_iter()
        .map(|(_, p)| p)
        .collect()
}

/// The outer outline of every 4-connected component of every label `>= 0` (or only of `only`),
/// in cells of `cell` metres starting at `origin`, with its label, in the order of each
/// component's first cell. The outlines have no holes and their signed area by the shoelace
/// formula on `(x, y)` (with `y` down) is positive.
pub(crate) fn outlines(
    labels: &Grid<i32>,
    only: Option<i32>,
    cell: f32,
    origin: [f32; 2],
    fit: Fit,
) -> Vec<(i32, Vec<[f32; 2]>)> {
    let (w, h) = (labels.w, labels.h);
    let mut comp = vec![u32::MAX; w * h];
    let mut stack = Vec::new();
    let mut out = Vec::new();
    for start in 0..w * h {
        let l = labels.data[start];
        if l < 0 || comp[start] != u32::MAX || only.is_some_and(|o| o != l) {
            continue;
        }
        let id = start as u32;
        comp[start] = id;
        stack.push(start);
        let mut count = 0;
        while let Some(i) = stack.pop() {
            count += 1;
            let (x, y) = (i % w, i / w);
            let around = [
                (x > 0).then(|| i - 1),
                (x + 1 < w).then(|| i + 1),
                (y > 0).then(|| i - w),
                (y + 1 < h).then(|| i + w),
            ];
            for n in around.into_iter().flatten() {
                if labels.data[n] == l && comp[n] == u32::MAX {
                    comp[n] = id;
                    stack.push(n);
                }
            }
        }
        if count < MIN_CELLS {
            continue;
        }
        let corners = walk(&comp, w, h, start);
        let pts: Vec<[f32; 2]> = corners
            .iter()
            .map(|&(x, y)| [origin[0] + x as f32 * cell, origin[1] + y as f32 * cell])
            .collect();
        let mut poly = match fit {
            Fit::Near => octilinear(&pts, cell),
            Fit::Inside => octilinear_inside(&pts, cell),
        };
        poly.pop();
        if poly.len() >= 3 {
            out.push((l, poly));
        }
    }
    out
}

/// The corners where the outline of the component holding cell `start` (its first cell in row
/// order) turns, walked with the component on the right (`y` down) from the cell's top left
/// corner; the first corner is repeated at the end.
fn walk(comp: &[u32], w: usize, h: usize, start: usize) -> Vec<(isize, isize)> {
    let id = comp[start];
    let (wi, hi) = (w as isize, h as isize);
    let ours = |(x, y): (isize, isize)| {
        x >= 0 && y >= 0 && x < wi && y < hi && comp[(y * wi + x) as usize] == id
    };
    // The cell on the right (`k = 1`) or on the left (`k = -1`) of the side that leaves corner
    // `v` along `d`.
    let side = |v: (isize, isize), d: (isize, isize), k: isize| {
        let half = |c: isize, s: isize| if s > 0 { c } else { c - 1 };
        (half(v.0, d.0 - k * d.1), half(v.1, d.1 + k * d.0))
    };
    let edge = |v, d| ours(side(v, d, 1)) && !ours(side(v, d, -1));
    let first = ((start % w) as isize, (start / w) as isize);
    let (mut v, mut d) = (first, (1isize, 0isize));
    let mut out = vec![first];
    // An outline has at most every cell side once.
    for _ in 0..4 * (w + 1) * (h + 1) {
        v = (v.0 + d.0, v.1 + d.1);
        // Turning right first keeps two cells that touch at a corner apart.
        let next = [(-d.1, d.0), d, (d.1, -d.0)]
            .into_iter()
            .find(|&n| edge(v, n))
            .unwrap_or((-d.0, -d.1));
        if next != d {
            out.push(v);
        }
        if v == first && next == (1, 0) {
            if out.last() != Some(&first) {
                out.push(first);
            }
            return out;
        }
        d = next;
    }
    out
}

/// Signed area by the shoelace formula, `y` down: positive for the outlines of [`outlines`].
pub(crate) fn area(poly: &[[f32; 2]]) -> f32 {
    let n = poly.len();
    (0..n)
        .map(|i| {
            let (p, q) = (poly[i], poly[(i + 1) % n]);
            p[0] * q[1] - q[0] * p[1]
        })
        .sum::<f32>()
        * 0.5
}

#[cfg(test)]
#[path = "vector_tests.rs"]
mod tests;
