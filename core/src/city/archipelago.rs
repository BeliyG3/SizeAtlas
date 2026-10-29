//! The archipelago: the islands of the open drives across their straits, and the bridges
//! between them.

use super::grid::{Grid, distance};
use super::map::{Island, PolyKind};
use super::path::point_segment;
use super::world::{SPIRAL, STRAIT};

/// Cell of the world raster, metres.
pub(crate) const WORLD_CELL: f32 = 6.0;
/// The raster's distances are off by up to a cell's diagonal at either end; within this band of
/// `STRAIT` a contour point is measured against the outlines themselves.
const BAND: f32 = 2.0 * WORLD_CELL;
/// Bisection steps along an island's ray.
const ROUNDS: usize = 30;

/// Where each island goes: the shift added to its points. The islands come in the order of
/// [`super::directions`]; the first has the middle of its outline's bounding box at `(0, 0)`, the
/// `i`-th lies on the ray `i · SPIRAL` from there, slid in until the sea between its outline and
/// the others' narrows to `STRAIT` (measured from points every `WORLD_CELL` along its outline).
pub fn place(islands: &[&Island]) -> Vec<[f32; 2]> {
    let mut at: Vec<[f32; 2]> = Vec::with_capacity(islands.len());
    let mut placed: Vec<Vec<Vec<[f32; 2]>>> = Vec::with_capacity(islands.len());
    // How far from the origin the placed outlines reach.
    let mut reach = 0.0f32;
    for (i, island) in islands.iter().enumerate() {
        let local = shape(island, [0.0; 2]);
        let (lo, hi) = bounds(local.iter().flatten());
        let c = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0];
        let half = (hi[0] - lo[0]).hypot(hi[1] - lo[1]) / 2.0;
        let a = i as f32 * SPIRAL;
        let shift = |t: f32| [t * a.cos() - c[0], t * a.sin() - c[1]];
        let offset = if placed.is_empty() {
            shift(0.0)
        } else {
            let world = World::new(&placed, STRAIT + BAND + WORLD_CELL);
            let land = Grid {
                data: world.owner.data.iter().map(|&o| o > 0).collect(),
                w: world.owner.w,
                h: world.owner.h,
            };
            let (dist, _) = distance(&land);
            let points: Vec<[f32; 2]> = local.iter().flat_map(|p| samples(p, true)).collect();
            let clear = |o: [f32; 2]| {
                let apart = points.iter().all(|p| {
                    let q = [p[0] + o[0], p[1] + o[1]];
                    let d = world
                        .cell(q)
                        .map_or(f32::INFINITY, |k| dist.data[k] * WORLD_CELL);
                    d >= STRAIT + BAND || (d >= STRAIT - BAND && nearest(&placed, q) >= STRAIT)
                });
                // An outline that would swallow a placed one has no point near it.
                let around = (placed.iter().flatten()).any(|poly| {
                    let p = [poly[0][0] - o[0], poly[0][1] - o[1]];
                    local.iter().any(|l| inside(p, l))
                });
                apart && !around
            };
            let (mut near, mut far) = (0.0, reach + half + STRAIT + BAND);
            for _ in 0..ROUNDS {
                let mid = (near + far) / 2.0;
                if clear(shift(mid)) {
                    far = mid;
                } else {
                    near = mid;
                }
            }
            shift(far)
        };
        reach = reach.max((offset[0] + c[0]).hypot(offset[1] + c[1]) + half);
        placed.push(shape(island, offset));
        at.push(offset);
    }
    at
}

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

fn bounds<'a>(points: impl IntoIterator<Item = &'a [f32; 2]>) -> ([f32; 2], [f32; 2]) {
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

/// Distance from `p` to the nearest side of the outlines `placed`.
fn nearest(placed: &[Vec<Vec<[f32; 2]>>], p: [f32; 2]) -> f32 {
    let mut best = f32::INFINITY;
    for poly in placed.iter().flatten() {
        let (lo, hi) = bounds(poly);
        let off = (lo[0] - p[0]).max(p[0] - hi[0]).max(0.0);
        let off = off.hypot((lo[1] - p[1]).max(p[1] - hi[1]).max(0.0));
        if off >= best {
            continue;
        }
        for i in 0..poly.len() {
            best = best.min(point_segment(p, poly[i], poly[(i + 1) % poly.len()]));
        }
    }
    best
}

fn inside(p: [f32; 2], poly: &[[f32; 2]]) -> bool {
    let mut odd = false;
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0])
        {
            odd = !odd;
        }
    }
    odd
}

/// The islands' outlines on a raster of `WORLD_CELL` metres: each cell holds `1 +` the index of
/// the island whose outline holds its centre, 0 for the sea.
pub(crate) struct World {
    pub owner: Grid<u16>,
    origin: [f32; 2],
}

impl World {
    /// The outlines `shapes` (world metres, one set per island) with `pad` metres of sea round.
    pub fn new(shapes: &[Vec<Vec<[f32; 2]>>], pad: f32) -> Self {
        let (lo, hi) = bounds(shapes.iter().flatten().flatten());
        let origin = [lo[0] - pad, lo[1] - pad];
        let w = ((hi[0] + pad - origin[0]) / WORLD_CELL).ceil() as usize + 1;
        let h = ((hi[1] + pad - origin[1]) / WORLD_CELL).ceil() as usize + 1;
        let mut owner = Grid::new(w, h, 0u16);
        for (k, poly) in
            (shapes.iter().enumerate()).flat_map(|(k, s)| s.iter().map(move |p| (k, p)))
        {
            fill(&mut owner, origin, poly, k as u16 + 1);
        }
        Self { owner, origin }
    }

    /// The index of the cell under `p`, if on the raster.
    pub fn cell(&self, p: [f32; 2]) -> Option<usize> {
        let x = ((p[0] - self.origin[0]) / WORLD_CELL).floor();
        let y = ((p[1] - self.origin[1]) / WORLD_CELL).floor();
        let on = x >= 0.0 && y >= 0.0 && (x as usize) < self.owner.w && (y as usize) < self.owner.h;
        on.then(|| self.owner.idx(x as usize, y as usize))
    }

    /// The islands whose outlines lie under the cell of `p` and the eight round it (`None` for
    /// the sea and off the raster).
    pub fn around(&self, p: [f32; 2]) -> [Option<usize>; 9] {
        let mut out = [None; 9];
        for (k, o) in out.iter_mut().enumerate() {
            let d = [(k % 3) as f32 - 1.0, (k / 3) as f32 - 1.0];
            let q = [p[0] + d[0] * WORLD_CELL, p[1] + d[1] * WORLD_CELL];
            let owner = self.cell(q).map_or(0, |c| self.owner.data[c]);
            *o = (owner > 0).then(|| usize::from(owner) - 1);
        }
        out
    }
}

/// Sets to `v` the cells of `grid` (from `origin`) whose centres lie inside `poly`, row by row.
fn fill(grid: &mut Grid<u16>, origin: [f32; 2], poly: &[[f32; 2]], v: u16) {
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
                    grid.set(x, y, v);
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "archipelago_tests.rs"]
mod tests;
