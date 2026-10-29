//! A bridge's way round the islands where the simple shape cannot keep clear of them: the
//! cheapest way with few turns over the open sea of the world raster, joined to the gates.

use super::bends::{length, sharp};
use super::chart::{WORLD_CELL, World};
use super::coast::{CLEAR, Coast, keeps_clear};
use super::grid::distance;
use super::landing::{clears, meet, onto};
use super::path::simplify;
use super::simple::{DIRS, LEAVE, route, snap};

/// Sea round the archipelago for the ways past its outer islands, metres.
const ROOM: f32 = 300.0;
/// Open sea lies this far from every outline: the raster is off by up to a cell's diagonal at
/// either end, metres.
const OPEN: f32 = CLEAR + 2.0 * WORLD_CELL;
/// A way sets out where a gate's straight first lies this far from every outline, metres.
const OUT: f32 = CLEAR + 3.0 * WORLD_CELL;
/// A gate's straight runs out at most this far before its way, metres.
const REACH: f32 = 1000.0;
/// No way is searched on a raster of more states (cells · headings) than this.
const MAX_STATES: usize = 2000 * 2000 * 8;
/// `back` of a state with none before it; the high bit marks a state done.
pub(crate) const START: u8 = 8;
pub(crate) const DONE: u8 = 0x80;

/// A gate: its island, its node and its outward direction, world metres.
pub(crate) type End = (usize, [f32; 2], [f32; 2]);

/// The world raster, its open sea, and the search's tables by state `cell · 8 + heading`: the
/// cheapest cost found and the heading of the state before (`START`, `DONE`), left reset.
pub(crate) struct Sea {
    world: World,
    open: Vec<bool>,
    best: Vec<f32>,
    back: Vec<u8>,
    /// Cells an earlier bridge runs over: a way along them costs `JOIN` of a step.
    used: Vec<bool>,
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
            best: vec![f32::INFINITY; states],
            back: vec![START; states],
            used: vec![false; open.len()],
            open,
        }
    }

    /// Marks the cells the bridge `points` runs over, so later ways go along it.
    pub fn mark(&mut self, points: &[[f32; 2]]) {
        for w in points.windows(2) {
            let l = (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1]);
            let n = (2.0 * l / WORLD_CELL).ceil() as usize;
            for k in 0..=n {
                let t = k as f32 / n.max(1) as f32;
                let p = [
                    w[0][0] + t * (w[1][0] - w[0][0]),
                    w[0][1] + t * (w[1][1] - w[0][1]),
                ];
                if let Some(c) = self.world.cell(p) {
                    self.used[c] = true;
                }
            }
        }
    }

    /// The bridge from gate `a` to gate `b`: out along `a`'s straight until it lies `OUT` from
    /// every outline, the cheapest way over the open sea to where `b`'s straight does, in along
    /// that; the way's first and last corner are reached from the gates by the shape of
    /// [`route`]. No corner turns more than 45°. `None` where it cannot keep clear (see
    /// [`keeps_clear`]), or where the way over the open sea costs more than `bound` (metres, a
    /// 45° turn as `BEND`).
    pub fn route(&mut self, coasts: &[Coast], a: End, b: End, bound: f32) -> Option<Vec<[f32; 2]>> {
        let ((i, pa, da), (j, pb, db)) = (a, b);
        let (from, to) = (self.out(coasts, a)?, self.out(coasts, b)?);
        let mut way = if from == to {
            vec![self.world.centre(from)]
        } else {
            let goal = heading([-db[0], -db[1]]);
            self.cheapest(from, heading(da), to, goal, bound / WORLD_CELL)?
        };
        // From `a` to the way's corner `c`, there heading `d` on to `next`; from the corner `c`
        // heading `d`, come from `prev`, to `b`. The gates' straights go on until they keep clear
        // of their coasts.
        let (sa, sb) = (clears(&coasts[i], pa, da), clears(&coasts[j], pb, db));
        let head = |c: [f32; 2], d: [f32; 2], next: [f32; 2]| {
            let clear = |p: &[[f32; 2]]| {
                keeps_clear(coasts, p, Some(i), None) && !sharp(&[p, &[next]].concat())
            };
            route(pa, da, c, [-d[0], -d[1]], (sa, 0.0), clear)
        };
        let tail = |c: [f32; 2], d: [f32; 2], prev: [f32; 2]| {
            let clear = |p: &[[f32; 2]]| {
                keeps_clear(coasts, p, None, Some(j)) && !sharp(&[&[prev], p].concat())
            };
            route(c, d, pb, db, (0.0, sb), clear)
        };
        let join = |head: Vec<[f32; 2]>, middle: &[[f32; 2]], tail: Vec<[f32; 2]>| {
            let mut all = head;
            all.extend_from_slice(middle);
            all.extend_from_slice(&tail[1..]);
            let all = simplify(all);
            (!sharp(&all) && keeps_clear(coasts, &all, Some(i), Some(j))).then_some(all)
        };
        // The two straights on to where they cross.
        let direct = || meet((pa, da), (pb, db)).and_then(|x| join(vec![pa, x], &[], vec![x, pb]));
        match way.len() {
            // Both straights set out from the same cell: the shortest of their crossing and the
            // ways through the cell's centre.
            1 => {
                let through = DIRS.iter().filter_map(|m| {
                    let (m, c) = (m.map(|x| x as f32), way[0]);
                    let (next, prev) = ([c[0] + m[0], c[1] + m[1]], [c[0] - m[0], c[1] - m[1]]);
                    join(head(c, m, next)?, &[], tail(c, m, prev)?)
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
        // `a` joins the way at the first corner it can reach, `b` at the last one after that
        // where the whole keeps clear and turns at most 45° at every corner.
        let last = (n - 1).max(1);
        (1..=last).find_map(|k| {
            // Past the way's last corner the tail goes on the way it heads.
            let next =
                (way.get(k + 1).copied()).unwrap_or([way[k][0] + dir(k)[0], way[k][1] + dir(k)[1]]);
            let h = head(way[k], dir(k), next)?;
            (k..=last).rev().find_map(|l| {
                let prev = if l > k { way[l - 1] } else { h[h.len() - 2] };
                let t = tail(way[l], dir((l + 1).min(n)), prev)?;
                join(h.clone(), &way[k + 1..=l], t)
            })
        })
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
}

/// The index of the direction of `DIRS` nearest to `d`.
fn heading(d: [f32; 2]) -> usize {
    let m = snap(d);
    DIRS.iter().position(|&k| k == m).unwrap_or(0)
}

#[path = "seaway_search.rs"]
mod search;

#[cfg(test)]
#[path = "seaway_tests.rs"]
mod tests;
