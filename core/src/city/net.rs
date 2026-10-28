//! The coarse grid the highways are searched for on, and the cheapest ways over it to the core.

use super::CELL;
use super::grid::{Grid, distance};
use super::path::{apart, octilinear, shortest, walk_back};
use std::collections::HashMap;

/// The grid has `G × G` cells per cell, `STEP` metres a side.
const G: usize = 3;
pub(crate) const STEP: f32 = G as f32 * CELL;
/// Cost of a cell near a district border (within `REACH` cells of it) and anywhere else on land.
const BORDER: f32 = 1.0;
const INLAND: f32 = 9.0;
const REACH: isize = 2;
/// A detour keeps this many cells of the grid from the sea where it can, and is searched this
/// many cells round its ends before the whole grid.
const OFFSHORE: f32 = 2.0;
const DETOUR_ROOM: usize = 40;

pub(crate) type Line = Vec<[f32; 2]>;

pub(crate) struct Net {
    cost: Grid<f32>,
    pred: Grid<u32>,
    /// The cell the ways start from, nearest to the core seed.
    from: usize,
}

impl Net {
    /// The grid over `land` split into districts `dist`, searched from the land nearest to
    /// `core` (metres); `None` without land.
    pub fn new(land: &Grid<bool>, dist: &Grid<i32>, core: [f32; 2]) -> Option<Self> {
        let mut cost = Grid::new(land.w / G, land.h / G, f32::INFINITY);
        for y in 0..cost.h {
            for x in 0..cost.w {
                let (fx, fy) = (x * G + G / 2, y * G + G / 2);
                if land.get(fx, fy) {
                    let near = near_border(dist, fx, fy);
                    cost.set(x, y, if near { BORDER } else { INLAND });
                }
            }
        }
        let mut net = Self {
            pred: Grid::new(cost.w, cost.h, u32::MAX),
            cost,
            from: 0,
        };
        let near = |i: usize| apart(net.centre(i), core);
        net.from = (0..net.cost.data.len())
            .filter(|&i| net.cost.data[i].is_finite())
            .min_by(|&i, &j| near(i).total_cmp(&near(j)))?;
        net.pred = shortest(&net.cost, (net.from % net.cost.w, net.from / net.cost.w));
        Some(net)
    }

    pub fn centre(&self, i: usize) -> [f32; 2] {
        let at = |c: usize| ((c * G + G / 2) as f32 + 0.5) * CELL;
        [at(i % self.cost.w), at(i / self.cost.w)]
    }

    fn reached(&self, i: usize) -> bool {
        i == self.from || self.pred.data[i] != u32::MAX
    }

    /// The cell under `p`, if the core reaches it.
    pub fn cell(&self, p: [f32; 2]) -> Option<usize> {
        let (x, y) = ((p[0] / STEP).floor(), (p[1] / STEP).floor());
        if x < 0.0 || y < 0.0 || x >= self.cost.w as f32 || y >= self.cost.h as f32 {
            return None;
        }
        let i = y as usize * self.cost.w + x as usize;
        self.reached(i).then_some(i)
    }

    /// The reached cell farthest along `d` from `core`.
    pub fn farthest(&self, core: [f32; 2], d: [f32; 2]) -> usize {
        let along = |i: usize| {
            let c = self.centre(i);
            (c[0] - core[0]) * d[0] + (c[1] - core[1]) * d[1]
        };
        (0..self.cost.data.len())
            .filter(|&i| self.reached(i))
            .fold(self.from, |b, i| if along(i) > along(b) { i } else { b })
    }

    /// The cheapest way to `core` from each start point (lying in its reached cell), octilinear.
    /// Where ways merge they run on: each stretch between merges is made octilinear once, so
    /// merged ways share their points exactly.
    pub fn routes(&self, starts: &[([f32; 2], usize)], core: [f32; 2]) -> Vec<Line> {
        let w = self.cost.w;
        let paths: Vec<Vec<usize>> = starts
            .iter()
            .map(|&(_, to)| {
                let cells = walk_back(&self.pred, (to % w, to / w));
                cells.into_iter().map(|(x, y)| y * w + x).collect()
            })
            .collect();
        let mut uses: HashMap<usize, usize> = HashMap::new();
        for &c in paths.iter().flatten() {
            *uses.entry(c).or_default() += 1;
        }
        let mut shared: HashMap<(usize, usize), Line> = HashMap::new();
        let mut out = Vec::with_capacity(paths.len());
        for (path, &(start, _)) in paths.iter().zip(starts) {
            let last = path.len() - 1;
            if last == 0 {
                out.push(octilinear(&[start, core], STEP));
                continue;
            }
            let mut line = vec![start];
            let mut a = 0;
            for b in 1..=last {
                if b < last && uses[&path[b]] == uses[&path[b - 1]] {
                    continue;
                }
                let make = || {
                    let mut pts: Line = path[a..=b].iter().map(|&c| self.centre(c)).collect();
                    if a == 0 {
                        pts[0] = start;
                    }
                    if b == last {
                        pts[b - a] = core;
                    }
                    octilinear(&pts, STEP)
                };
                let piece = if a == 0 {
                    make()
                } else {
                    shared
                        .entry((path[a], path[b]))
                        .or_insert_with(make)
                        .clone()
                };
                line.extend_from_slice(&piece[1..]);
                a = b;
            }
            out.push(line);
        }
        out
    }

    /// A way from `a` to `b` over the land of the grid, octilinear, keeping `OFFSHORE` from the
    /// sea where it can so the straightening stays on the land; `None` when the land does not
    /// join them. Searched near the two ends first, then over the whole grid.
    pub fn detour(&self, a: [f32; 2], b: [f32; 2]) -> Option<Line> {
        let at = |p: [f32; 2]| {
            let c = |v: f32, n: usize| ((v / STEP).floor().max(0.0) as usize).min(n - 1);
            (c(p[0], self.cost.w), c(p[1], self.cost.h))
        };
        let (ca, cb) = (at(a), at(b));
        let (lo, hi) = (
            (ca.0.min(cb.0), ca.1.min(cb.1)),
            (ca.0.max(cb.0), ca.1.max(cb.1)),
        );
        let path = [DETOUR_ROOM, usize::MAX].into_iter().find_map(|room| {
            let x = (
                lo.0.saturating_sub(room),
                hi.0.saturating_add(room).min(self.cost.w - 1),
            );
            let y = (
                lo.1.saturating_sub(room),
                hi.1.saturating_add(room).min(self.cost.h - 1),
            );
            let (w, h) = (x.1 - x.0 + 1, y.1 - y.0 + 1);
            let near = |i: usize| self.cost.get(x.0 + i % w, y.0 + i / w);
            let sea = Grid {
                data: (0..w * h).map(|i| near(i).is_infinite()).collect(),
                w,
                h,
            };
            let (offshore, _) = distance(&sea);
            let mut cost = Grid {
                data: (0..w * h)
                    .map(|i| match near(i) {
                        c if c.is_infinite() => c,
                        _ if offshore.data[i] >= OFFSHORE => BORDER,
                        _ => INLAND,
                    })
                    .collect(),
                w,
                h,
            };
            let (sa, sb) = ((ca.0 - x.0, ca.1 - y.0), (cb.0 - x.0, cb.1 - y.0));
            cost.set(sa.0, sa.1, BORDER);
            cost.set(sb.0, sb.1, BORDER);
            let path = walk_back(&shortest(&cost, sb), sa);
            (path.last() == Some(&sb)).then(|| {
                let back = |(px, py): (usize, usize)| (py + y.0) * self.cost.w + px + x.0;
                path.into_iter().map(back).collect::<Vec<usize>>()
            })
        })?;
        let mut pts: Line = path.into_iter().map(|i| self.centre(i)).collect();
        pts[0] = a;
        if pts.len() == 1 {
            pts.push(b);
        } else if let Some(last) = pts.last_mut() {
            *last = b;
        }
        Some(octilinear(&pts, STEP))
    }
}

/// Whether a district border lies within `REACH` cells of cell `(x, y)`. A border cell has its
/// right or bottom neighbour in another district; the shore does not count, or the highways
/// would run round the island.
fn near_border(dist: &Grid<i32>, x: usize, y: usize) -> bool {
    let (w, h) = (dist.w as isize, dist.h as isize);
    let label = |x: isize, y: isize| {
        if x >= 0 && y >= 0 && x < w && y < h {
            dist.data[(y * w + x) as usize]
        } else {
            -1
        }
    };
    let border = |x: isize, y: isize| {
        let l = label(x, y);
        let other = |m: i32| m >= 0 && m != l;
        l >= 0 && (other(label(x + 1, y)) || other(label(x, y + 1)))
    };
    let (x, y) = (x as isize, y as isize);
    (-REACH..=REACH).any(|dy| {
        (-REACH..=REACH).any(|dx| dx * dx + dy * dy <= REACH * REACH && border(x + dx, y + dy))
    })
}
