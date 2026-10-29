//! The search of a bridge's way over the open sea (A*), by cell and heading.

use super::{DONE, START, Sea};
use crate::city::bends::BEND;
use crate::city::chart::WORLD_CELL;
use crate::city::path::simplify;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::f32::consts::SQRT_2;

/// A turn costs as much as this many cells of way, per 45°.
const TURN: f32 = BEND / WORLD_CELL;
/// A step along an earlier bridge costs this share of one: later ways join its corridor.
const JOIN: f32 = 0.3;
/// A search gives up after this many states.
const MAX_POPS: usize = 2_000_000;
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

impl Sea {
    /// The corners of the cheapest way (A*) over the open sea from cell `from`, heading `dir`
    /// (an index of `DIRS`), to cell `to`, there heading `goal`: a step costs its length in
    /// cells and turns at most 45°, which costs `TURN`. States that cannot reach `to` within
    /// `bound` (cells) are left out. Cell centres, both ends included; `None` past `MAX_POPS`
    /// states.
    pub(super) fn cheapest(
        &mut self,
        from: usize,
        dir: usize,
        to: usize,
        goal: usize,
        bound: f32,
    ) -> Option<Vec<[f32; 2]>> {
        if self.best.is_empty() {
            return None;
        }
        let (w, h) = (self.world.land.w as isize, self.world.land.h as isize);
        let xy = |c: usize| (c as isize % w, c as isize / w);
        let (tx, ty) = xy(to);
        // The way left as the crow flies along the eight directions, and the turns onto `goal`.
        let guess = |c: usize, d: usize| {
            let (x, y) = xy(c);
            let (dx, dy) = ((x - tx).abs() as f32, (y - ty).abs() as f32);
            dx.max(dy) + (SQRT_2 - 1.0) * dx.min(dy) + TURN * turn(d, goal) as f32
        };
        let mut touched = vec![from * 8 + dir];
        let mut heap = BinaryHeap::new();
        self.best[from * 8 + dir] = 0.0;
        heap.push(Reverse((guess(from, dir).to_bits(), from * 8 + dir)));
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
            if c == to && d == goal {
                found = Some(s);
                break;
            }
            let (g, (x, y)) = (self.best[s], xy(c));
            for (k, (mx, my)) in MOVES.into_iter().enumerate() {
                let turn = turn(d, k);
                let (nx, ny) = (x + mx, y + my);
                let open = |x: isize, y: isize| self.open[(y * w + x) as usize];
                if turn > 1 || nx < 0 || ny < 0 || nx >= w || ny >= h || !open(nx, ny) {
                    continue;
                }
                let diagonal = mx != 0 && my != 0;
                if diagonal && !(open(nx, y) && open(x, ny)) {
                    continue;
                }
                let step = if diagonal { SQRT_2 } else { 1.0 };
                let n = (ny * w + nx) as usize;
                let step = if self.used[n] { JOIN * step } else { step };
                let cost = g + step + TURN * turn as f32;
                let next = n * 8 + k;
                let reach = cost + guess(n, k);
                if reach <= bound && cost < self.best[next] && self.back[next] & DONE == 0 {
                    self.best[next] = cost;
                    self.back[next] = d as u8;
                    touched.push(next);
                    heap.push(Reverse((reach.to_bits(), next)));
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

/// How many steps of 45° lie between the headings `a` and `b` (indices of `DIRS`).
fn turn(a: usize, b: usize) -> usize {
    let t = (b + 8 - a) % 8;
    t.min(8 - t)
}
