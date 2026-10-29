//! The chart of the archipelago: the islands' outlines in world metres, and those outlines on a
//! raster.

use super::grid::Grid;
use super::map::{Island, PolyKind};

/// Cell of the world raster, metres.
pub(crate) const WORLD_CELL: f32 = 6.0;

/// The island's outline polygons moved by `at`; its frame where it has none.
pub(crate) fn shape(island: &Island, at: [f32; 2]) -> Vec<Vec<[f32; 2]>> {
    let mut out: Vec<Vec<[f32; 2]>> = (island.polys.iter())
        .filter(|p| p.kind == PolyKind::Island && p.points.len() >= 3)
        .map(|p| p.points.clone())
        .collect();
    if out.is_empty() {
        let (w, h) = (island.width.max(1.0), island.height.max(1.0));
        out.push(vec![[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]]);
    }
    for p in out.iter_mut().flatten() {
        *p = [p[0] + at[0], p[1] + at[1]];
    }
    out
}

pub(crate) fn bounds<'a>(points: impl IntoIterator<Item = &'a [f32; 2]>) -> ([f32; 2], [f32; 2]) {
    let start = ([f32::INFINITY; 2], [f32::NEG_INFINITY; 2]);
    points.into_iter().fold(start, |(lo, hi), p| {
        (
            [lo[0].min(p[0]), lo[1].min(p[1])],
            [hi[0].max(p[0]), hi[1].max(p[1])],
        )
    })
}

/// Points every `WORLD_CELL` or less along `line`, its vertices included; `closed` goes on from
/// the last point back to the first.
pub(crate) fn samples(line: &[[f32; 2]], closed: bool) -> Vec<[f32; 2]> {
    let n = line.len();
    let mut out = Vec::new();
    for i in 0..if closed { n } else { n.saturating_sub(1) } {
        let (a, b) = (line[i], line[(i + 1) % n]);
        let k = ((b[0] - a[0]).hypot(b[1] - a[1]) / WORLD_CELL)
            .ceil()
            .max(1.0) as usize;
        out.extend((0..k).map(|s| {
            let t = s as f32 / k as f32;
            [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
        }));
    }
    if !closed && let Some(&last) = line.last() {
        out.push(last);
    }
    out
}

/// The islands' outlines on a raster of `WORLD_CELL` metres: a cell is land where an outline
/// holds its centre.
pub(crate) struct World {
    pub land: Grid<bool>,
    origin: [f32; 2],
}

impl World {
    /// The outlines `shapes` (world metres, one set per island) with `pad` metres of sea round.
    pub fn new(shapes: &[Vec<Vec<[f32; 2]>>], pad: f32) -> Self {
        let (lo, hi) = bounds(shapes.iter().flatten().flatten());
        let origin = [lo[0] - pad, lo[1] - pad];
        let w = ((hi[0] + pad - origin[0]) / WORLD_CELL).ceil() as usize + 1;
        let h = ((hi[1] + pad - origin[1]) / WORLD_CELL).ceil() as usize + 1;
        let mut land = Grid::new(w, h, false);
        for poly in shapes.iter().flatten() {
            fill(&mut land, origin, poly);
        }
        Self { land, origin }
    }

    /// The index of the cell under `p`, if on the raster.
    pub fn cell(&self, p: [f32; 2]) -> Option<usize> {
        let x = ((p[0] - self.origin[0]) / WORLD_CELL).floor();
        let y = ((p[1] - self.origin[1]) / WORLD_CELL).floor();
        let on = x >= 0.0 && y >= 0.0 && (x as usize) < self.land.w && (y as usize) < self.land.h;
        on.then(|| self.land.idx(x as usize, y as usize))
    }

    /// The centre of cell `i`.
    pub fn centre(&self, i: usize) -> [f32; 2] {
        let (x, y) = ((i % self.land.w) as f32, (i / self.land.w) as f32);
        [
            self.origin[0] + (x + 0.5) * WORLD_CELL,
            self.origin[1] + (y + 0.5) * WORLD_CELL,
        ]
    }
}

/// Sets the cells of `grid` (from `origin`) whose centres lie inside `poly`, row by row.
fn fill(grid: &mut Grid<bool>, origin: [f32; 2], poly: &[[f32; 2]]) {
    // The first and last cell whose centre is at or past `lo`, at or before `hi` (metres from
    // the origin), within `n` cells.
    let cells = |lo: f32, hi: f32, n: usize| {
        let first = (lo / WORLD_CELL - 0.5).ceil().max(0.0) as usize;
        let last = (hi / WORLD_CELL - 0.5).floor();
        (last >= 0.0).then(|| (first, (last as usize).min(n - 1)))
    };
    let (lo, hi) = bounds(poly);
    let Some((y0, y1)) = cells(lo[1] - origin[1], hi[1] - origin[1], grid.h) else {
        return;
    };
    let mut xs = Vec::new();
    for y in y0..=y1 {
        let cy = origin[1] + (y as f32 + 0.5) * WORLD_CELL;
        xs.clear();
        for i in 0..poly.len() {
            let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
            if (a[1] > cy) != (b[1] > cy) {
                xs.push(a[0] + (cy - a[1]) / (b[1] - a[1]) * (b[0] - a[0]) - origin[0]);
            }
        }
        xs.sort_by(f32::total_cmp);
        for pair in xs.chunks_exact(2) {
            if let Some((x0, x1)) = cells(pair[0], pair[1], grid.w) {
                for x in x0..=x1 {
                    grid.set(x, y, true);
                }
            }
        }
    }
}
