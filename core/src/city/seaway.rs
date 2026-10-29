//! A bridge's way round the islands where the simple shape cannot keep clear of them: the
//! cheapest way with few turns over the open sea of the world raster, joined to the gates.

use super::chart::{WORLD_CELL, World};
use super::coast::{CLEAR, Coast, keeps_clear};
use super::grid::distance;
use super::landing::{length, meet, onto, turns_back};
use super::path::simplify;
use super::span::{DIRS, LEAVE, route, snap};
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::f32::consts::SQRT_2;

/// Sea round the archipelago for the ways past its outer islands, metres.
const ROOM: f32 = 300.0;
/// Open sea lies this far from every outline: the raster is off by up to a cell's diagonal at
/// either end, metres.
const OPEN: f32 = CLEAR + 2.0 * WORLD_CELL;
/// A way sets out where a gate's straight first lies this far from every outline, metres.
const OUT: f32 = CLEAR + 3.0 * WORLD_CELL;
/// A gate's straight runs out at most this far before its way, metres.
const REACH: f32 = 300.0;
/// A turn costs as much as this many cells of way, per 45°.
const TURN: f32 = 5.0;
/// A search gives up after this many states.
const MAX_POPS: usize = 2_000_000;
/// No way is searched on a raster of more states (cells · headings) than this.
const MAX_STATES: usize = 2000 * 2000 * 8;
/// `back` of a state with none before it; the high bit marks a state done.
const START: u8 = 8;
const DONE: u8 = 0x80;
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

/// The world raster, its open sea, and the search's tables by state `cell · 8 + heading`: the
/// cheapest cost found and the heading of the state before (`START`, `DONE`), left reset.
pub(crate) struct Sea {
    world: World,
    open: Vec<bool>,
    best: Vec<f32>,
    back: Vec<u8>,
}

impl Sea {
    pub fn new(shapes: &[Vec<Vec<[f32; 2]>>]) -> Self {
        let world = World::new(shapes, ROOM);
        let (dist, _) = distance(&world.land);
        let open: Vec<bool> = dist.data.iter().map(|&d| d * WORLD_CELL >= OPEN).collect();
        let states = if open.len() * 8 <= MAX_STATES {
            open.len() * 8
        } else {
            0
        };
        Self {
            world,
            open,
            best: vec![f32::INFINITY; states],
            back: vec![START; states],
        }
    }

    /// The bridge from gate `a` to gate `b`: out along `a`'s straight until it lies `OUT` from
    /// every outline, the cheapest way over the open sea to where `b`'s straight does, in along
    /// that; the way's first and last corner are reached from the gates by the shape of
    /// [`route`]. `None` where it cannot keep clear (see [`keeps_clear`]).
    pub fn route(&mut self, coasts: &[Coast], a: End, b: End) -> Option<Vec<[f32; 2]>> {
        let ((i, pa, da), (j, pb, db)) = (a, b);
        let (from, to) = (self.out(coasts, a)?, self.out(coasts, b)?);
        let mut way = self.cheapest(from, heading(da), to)?;
        let head = |c: [f32; 2], d: [f32; 2]| {
            let clear = |p: &[[f32; 2]]| keeps_clear(coasts, p, Some(i), None);
            route(pa, da, c, [-d[0], -d[1]], (LEAVE, 0.0), clear)
        };
        let tail = |c: [f32; 2], d: [f32; 2]| {
            let clear = |p: &[[f32; 2]]| keeps_clear(coasts, p, None, Some(j));
            route(c, d, pb, db, (0.0, LEAVE), clear)
        };
        let join = |head: Vec<[f32; 2]>, middle: &[[f32; 2]], tail: Vec<[f32; 2]>| {
            let mut all = head;
            all.extend_from_slice(middle);
            all.extend_from_slice(&tail[1..]);
            let all = simplify(all);
            (!turns_back(&all) && keeps_clear(coasts, &all, Some(i), Some(j))).then_some(all)
        };
        // The two straights on to where they cross.
        let direct = || meet((pa, da), (pb, db)).and_then(|x| join(vec![pa, x], &[], vec![x, pb]));
        match way.len() {
            // Both straights set out from the same cell: the shortest of their crossing and the
            // ways through the cell's centre.
            1 => {
                let through = DIRS.iter().filter_map(|m| {
                    let m = m.map(|x| x as f32);
                    join(head(way[0], m)?, &[], tail(way[0], m)?)
                });
                let shortest =
                    |p: &Vec<[f32; 2]>, q: &Vec<[f32; 2]>| length(p).total_cmp(&length(q));
                return direct().into_iter().chain(through).min_by(shortest);
            }
            // A single corner goes where the straights cross; else onto `a`'s straight alone, as
            // sliding it onto `b`'s too would slide it off `a`'s.
            3 => match direct() {
                Some(p) => return Some(p),
                None => onto(&mut way, pa, da, true),
            },
            _ => {
                onto(&mut way, pa, da, true);
                onto(&mut way, pb, db, false);
            }
        }
        let n = way.len() - 1;
        let dir = |k: usize| [way[k][0] - way[k - 1][0], way[k][1] - way[k - 1][1]];
        // `a` joins the way at the first corner it can reach, `b` at the last one after that.
        let last = (n - 1).max(1);
        let (k, h) = (1..=last).find_map(|k| head(way[k], dir(k)).map(|h| (k, h)))?;
        let (l, t) = (k..=last)
            .rev()
            .find_map(|l| tail(way[l], dir((l + 1).min(n))).map(|t| (l, t)))?;
        join(h, &way[k + 1..=l], t)
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
    /// 45°, and a way never turns right round. Cell centres, both ends included; `None` past
    /// `MAX_POPS` states.
    fn cheapest(&mut self, from: usize, dir: usize, to: usize) -> Option<Vec<[f32; 2]>> {
        if self.best.is_empty() {
            return None;
        }
        let (w, h) = (self.world.land.w as isize, self.world.land.h as isize);
        let xy = |c: usize| (c as isize % w, c as isize / w);
        let (tx, ty) = xy(to);
        let guess = |c: usize| {
            let (x, y) = xy(c);
            let (dx, dy) = ((x - tx).abs() as f32, (y - ty).abs() as f32);
            dx.max(dy) + (SQRT_2 - 1.0) * dx.min(dy)
        };
        let mut touched = vec![from * 8 + dir];
        let mut heap = BinaryHeap::new();
        self.best[from * 8 + dir] = 0.0;
        heap.push(Reverse((guess(from).to_bits(), from * 8 + dir)));
        let mut found = None;
        for _ in 0..MAX_POPS {
            let Some(Reverse((_, s))) = heap.pop() else {
                break;
            };
            if self.back[s] & DONE != 0 {
                continue;
            }
            self.back[s] |= DONE;
            let (c, d) = (s / 8, s % 8);
            if c == to {
                found = Some(s);
                break;
            }
            let (g, (x, y)) = (self.best[s], xy(c));
            for (k, (mx, my)) in MOVES.into_iter().enumerate() {
                let turn = (k + 8 - d) % 8;
                let turn = turn.min(8 - turn);
                let (nx, ny) = (x + mx, y + my);
                let open = |x: isize, y: isize| self.open[(y * w + x) as usize];
                if turn == 4 || nx < 0 || ny < 0 || nx >= w || ny >= h || !open(nx, ny) {
                    continue;
                }
                let diagonal = mx != 0 && my != 0;
                if diagonal && !(open(nx, y) && open(x, ny)) {
                    continue;
                }
                let step = if diagonal { SQRT_2 } else { 1.0 };
                let (n, cost) = ((ny * w + nx) as usize, g + step + TURN * turn as f32);
                let next = n * 8 + k;
                if cost < self.best[next] && self.back[next] & DONE == 0 {
                    self.best[next] = cost;
                    self.back[next] = d as u8;
                    touched.push(next);
                    heap.push(Reverse(((cost + guess(n)).to_bits(), next)));
                }
            }
        }
        let way = found.map(|mut s| {
            let mut cells = vec![s / 8];
            while self.back[s] & !DONE != START {
                let (mx, my) = MOVES[s % 8];
                let (x, y) = xy(s / 8);
                let prev = ((y - my) * w + x - mx) as usize;
                s = prev * 8 + usize::from(self.back[s] & !DONE);
                cells.push(prev);
            }
            simplify(cells.iter().rev().map(|&c| self.world.centre(c)).collect())
        });
        for s in touched {
            (self.best[s], self.back[s]) = (f32::INFINITY, START);
        }
        way
    }
}

/// The index of the direction of `DIRS` nearest to `d`.
fn heading(d: [f32; 2]) -> usize {
    let m = snap(d);
    DIRS.iter().position(|&k| k == m).unwrap_or(0)
}

#[cfg(test)]
#[path = "seaway_tests.rs"]
mod tests;
