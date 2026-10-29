//! The search of a bridge's way over the open sea (A*), by cell and heading.

use super::{DONE, START, Sea};
use crate::city::bends::BEND;
use crate::city::chart::WORLD_CELL;
use crate::city::path::simplify;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::f32::consts::SQRT_2;
use std::hash::{BuildHasherDefault, Hasher};

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

/// The states seen by a search, by `cell · 8 + heading`: the cheapest cost found and the
/// heading of the state before (`START`; `DONE` marks it done). Only the states a search
/// reaches take room (some 15 MB for the largest archipelago, where tables of every state took
/// 200 MB), so a raster of any size is searched.
pub(super) type Seen = HashMap<usize, (f32, u8), BuildHasherDefault<StateHash>>;

/// A state's hash: its index times an odd constant (Fibonacci hashing), cheaper than the
/// default hasher on the search's millions of lookups.
#[derive(Default)]
pub(super) struct StateHash(u64);

const FIBONACCI: u64 = 0x9E37_79B9_7F4A_7C15;

impl Hasher for StateHash {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ u64::from(b)).wrapping_mul(FIBONACCI);
        }
    }

    fn write_usize(&mut self, n: usize) {
        self.0 = (n as u64).wrapping_mul(FIBONACCI);
    }
}

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
        let (w, h) = (self.world.land.w as isize, self.world.land.h as isize);
        let xy = |c: usize| (c as isize % w, c as isize / w);
        let (tx, ty) = xy(to);
        // The way left as the crow flies along the eight directions, and the turns onto `goal`.
        let guess = |c: usize, d: usize| {
            let (x, y) = xy(c);
            let (dx, dy) = ((x - tx).abs() as f32, (y - ty).abs() as f32);
            dx.max(dy) + (SQRT_2 - 1.0) * dx.min(dy) + TURN * turn(d, goal) as f32
        };
        let mut heap = BinaryHeap::new();
        self.seen.insert(from * 8 + dir, (0.0, START));
        heap.push(Reverse((guess(from, dir).to_bits(), from * 8 + dir)));
        let mut found = None;
        for _ in 0..MAX_POPS {
            let Some(Reverse((_, s))) = heap.pop() else {
                break;
            };
            let state = self
                .seen
                .get_mut(&s)
                .expect("a state is seen before it is queued");
            if state.1 & DONE != 0 {
                continue;
            }
            state.1 |= DONE;
            let g = state.0;
            let (c, d) = (s / 8, s % 8);
            if c == to && d == goal {
                found = Some(s);
                break;
            }
            let (x, y) = xy(c);
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
                if reach > bound {
                    continue;
                }
                let state = self.seen.entry(next).or_insert((f32::INFINITY, START));
                if cost < state.0 && state.1 & DONE == 0 {
                    *state = (cost, d as u8);
                    heap.push(Reverse((reach.to_bits(), next)));
                }
            }
        }
        let way = found.map(|mut s| {
            let mut cells = vec![s / 8];
            while self.seen[&s].1 & !DONE != START {
                let (mx, my) = MOVES[s % 8];
                let (x, y) = xy(s / 8);
                let prev = ((y - my) * w + x - mx) as usize;
                s = prev * 8 + usize::from(self.seen[&s].1 & !DONE);
                cells.push(prev);
            }
            simplify(cells.iter().rev().map(|&c| self.world.centre(c)).collect())
        });
        self.seen.clear();
        way
    }
}

/// How many steps of 45° lie between the headings `a` and `b` (indices of `DIRS`).
fn turn(a: usize, b: usize) -> usize {
    let t = (b + 8 - a) % 8;
    t.min(8 - t)
}
