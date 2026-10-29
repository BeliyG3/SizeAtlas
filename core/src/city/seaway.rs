//! A bridge's way round the islands where the simple shape cannot keep clear of them: the
//! cheapest way with few turns over the open sea of the world raster, joined to the gates.

use super::chart::{WORLD_CELL, World};
use super::coast::{CLEAR, Coast, keeps_clear};
use super::grid::distance;
use super::path::simplify;
use super::span::{DIRS, LEAVE, route, snap};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::f32::consts::SQRT_2;

/// Sea round the archipelago for the ways past its outer islands, metres.
const ROOM: f32 = 300.0;
/// Open sea lies this far from every outline: the raster is off by up to a cell's diagonal at
/// either end, metres.
const OPEN: f32 = CLEAR + 2.0 * WORLD_CELL;
/// A way sets out where a gate's straight first lies this far from every outline, metres.
const OUT: f32 = CLEAR + 3.0 * WORLD_CELL;
/// A gate's straight runs out at most this far before its way, metres.
const REACH: f32 = 1000.0;
/// A turn costs as much as this many cells of way, per 45°.
const TURN: f32 = 5.0;
/// The steps between cells, in the order of `DIRS`.
const MOVES: [(isize, isize); 8] = [
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
    (0, -1),
    (1, -1),
];

/// A gate: its island, its node and its outward direction, world metres.
pub(crate) type End = (usize, [f32; 2], [f32; 2]);

/// The world raster and its open sea.
pub(crate) struct Sea {
    world: World,
    open: Vec<bool>,
}

impl Sea {
    pub fn new(shapes: &[Vec<Vec<[f32; 2]>>]) -> Self {
        let world = World::new(shapes, ROOM);
        let (dist, _) = distance(&world.land);
        let open = dist.data.iter().map(|&d| d * WORLD_CELL >= OPEN).collect();
        Self { world, open }
    }

    /// The bridge from gate `a` to gate `b`: out along `a`'s straight until it lies `OUT` from
    /// every outline, the cheapest way over the open sea to where `b`'s straight does, in along
    /// that; the way's first and last corner are reached from the gates by the shape of
    /// [`route`]. `None` where it cannot keep clear (see [`keeps_clear`]).
    pub fn route(&self, coasts: &[Coast], a: End, b: End) -> Option<Vec<[f32; 2]>> {
        let ((i, pa, da), (j, pb, db)) = (a, b);
        let (from, to) = (self.out(coasts, a)?, self.out(coasts, b)?);
        let way = self.cheapest(from, heading(da), to)?;
        let n = way.len() - 1;
        if n == 0 {
            return None;
        }
        let dir = |k: usize| [way[k][0] - way[k - 1][0], way[k][1] - way[k - 1][1]];
        // `a` joins the way at the first corner it can reach, `b` at the last one after that.
        let last = (n - 1).max(1);
        let (k, head) = (1..=last).find_map(|k| {
            let d = dir(k);
            let clear = |p: &[[f32; 2]]| keeps_clear(coasts, p, Some(i), None);
            route(pa, da, way[k], [-d[0], -d[1]], (LEAVE, 0.0), clear).map(|h| (k, h))
        })?;
        let (l, tail) = (k..=last).rev().find_map(|l| {
            let clear = |p: &[[f32; 2]]| keeps_clear(coasts, p, None, Some(j));
            route(way[l], dir((l + 1).min(n)), pb, db, (0.0, LEAVE), clear).map(|t| (l, t))
        })?;
        let mut all = head;
        all.extend_from_slice(&way[k + 1..=l]);
        all.extend_from_slice(&tail[1..]);
        let all = simplify(all);
        let back = all.windows(3).any(|w| {
            let (u, v) = (
                [w[1][0] - w[0][0], w[1][1] - w[0][1]],
                [w[2][0] - w[1][0], w[2][1] - w[1][1]],
            );
            u[0] * v[0] + u[1] * v[1] < (-1.0 + 1e-3) * u[0].hypot(u[1]) * v[0].hypot(v[1])
        });
        (!back && keeps_clear(coasts, &all, Some(i), Some(j))).then_some(all)
    }

    /// The open cell where the way from gate `(k, p, d)` sets out: the first point every
    /// `WORLD_CELL` along its straight past `LEAVE`, up to `REACH`, that lies `OUT` from every
    /// outline; the straight keeps `CLEAR` from the other islands up to there.
    fn out(&self, coasts: &[Coast], (k, p, d): End) -> Option<usize> {
        let d = snap(d).map(|x| x as f32);
        let mut s = LEAVE as f32;
        while s <= REACH {
            let q = [p[0] + s * d[0], p[1] + s * d[1]];
            if (coasts.iter().enumerate()).any(|(o, c)| o != k && c.near(q, CLEAR)) {
                return None;
            }
            if s > LEAVE as f32 && coasts.iter().all(|c| !c.near(q, OUT)) {
                return self.world.cell(q).filter(|&c| self.open[c]);
            }
            s += WORLD_CELL;
        }
        None
    }

    /// The corners of the cheapest way (A*) over the open sea from cell `from`, heading `dir`
    /// (an index of `DIRS`), to cell `to`: a step costs its length in cells, a turn `TURN` per
    /// 45°, and a way never turns right round. Cell centres, both ends included.
    fn cheapest(&self, from: usize, dir: usize, to: usize) -> Option<Vec<[f32; 2]>> {
        let (w, h) = (self.world.land.w as isize, self.world.land.h as isize);
        let xy = |c: usize| (c as isize % w, c as isize / w);
        let open = |x: isize, y: isize| self.open[(y * w + x) as usize];
        let (tx, ty) = xy(to);
        let guess = |c: usize| {
            let (x, y) = xy(c);
            let (dx, dy) = ((x - tx).abs() as f32, (y - ty).abs() as f32);
            dx.max(dy) + (SQRT_2 - 1.0) * dx.min(dy)
        };
        // A state is a cell and the heading it was reached with: `cell · 8 + heading`.
        let mut best: HashMap<usize, f32> = HashMap::new();
        let mut back: HashMap<usize, usize> = HashMap::new();
        let mut done: HashSet<usize> = HashSet::new();
        let mut heap = BinaryHeap::new();
        best.insert(from * 8 + dir, 0.0);
        heap.push(Reverse((guess(from).to_bits(), from * 8 + dir)));
        while let Some(Reverse((_, s))) = heap.pop() {
            if !done.insert(s) {
                continue;
            }
            let (c, d) = (s / 8, s % 8);
            if c == to {
                let mut cells = vec![c];
                let mut s = s;
                while let Some(&p) = back.get(&s) {
                    s = p;
                    cells.push(s / 8);
                }
                let centres = cells.iter().rev().map(|&c| self.world.centre(c));
                return Some(simplify(centres.collect()));
            }
            let (g, (x, y)) = (best[&s], xy(c));
            for (k, (mx, my)) in MOVES.into_iter().enumerate() {
                let turn = (k + 8 - d) % 8;
                let turn = turn.min(8 - turn);
                let (nx, ny) = (x + mx, y + my);
                let diagonal = mx != 0 && my != 0;
                if turn == 4 || nx < 0 || ny < 0 || nx >= w || ny >= h || !open(nx, ny) {
                    continue;
                }
                if diagonal && !(open(nx, y) && open(x, ny)) {
                    continue;
                }
                let step = if diagonal { SQRT_2 } else { 1.0 };
                let (n, cost) = ((ny * w + nx) as usize, g + step + TURN * turn as f32);
                let next = n * 8 + k;
                if best.get(&next).is_none_or(|&b| cost < b) {
                    best.insert(next, cost);
                    back.insert(next, s);
                    heap.push(Reverse(((cost + guess(n)).to_bits(), next)));
                }
            }
        }
        None
    }
}

/// The index of the direction of `DIRS` nearest to `d`.
fn heading(d: [f32; 2]) -> usize {
    let m = snap(d);
    DIRS.iter().position(|&k| k == m).unwrap_or(0)
}
