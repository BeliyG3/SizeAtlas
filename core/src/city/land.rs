//! The island's land: overlapping octagons around the district seeds.

use super::CELL;
use super::grid::{Grid, close, fill_holes, label};
use super::rng::Rng;
use std::cmp::Reverse;

/// Golden angle, radians: consecutive seeds of the spiral turn by it.
const GOLDEN: f32 = 2.39996;
/// Seed `i` of the spiral lies `SPIRAL · √(area of the districts before it)` from the core (the
/// sketch's rings of 115 m at its sizes), so each district has room for its own area.
const SPIRAL: f32 = 0.5;
/// Gaps and notches narrower than twice this are closed, metres.
const CLOSING: f32 = 30.0;
/// Cell of the coarse raster the overall scale is fitted on, metres.
const COARSE: f32 = 6.0;
const FIT_ROUNDS: usize = 3;
/// A district cut off from the main land moves this share of the way to the core per try.
const PULL: f32 = 0.15;
/// Tries before the pieces off the main land are dropped (the sweeps in the tests need 1).
const MAX_PULLS: usize = 20;

/// Seeds of `n` districts in units of the spiral's ring step: the core at the origin, the rest
/// on a golden-angle spiral around it, slightly squashed along `y`.
pub(crate) fn seeds(n: usize, rng: &mut Rng) -> Vec<[f32; 2]> {
    (0..n)
        .map(|i| {
            if i == 0 {
                return [0.0, 0.0];
            }
            let a = i as f32 * GOLDEN + rng.range(-0.3, 0.3);
            let r = (i as f32).sqrt() * rng.range(0.9, 1.15);
            [r * a.cos(), 0.85 * r * a.sin()]
        })
        .collect()
}

/// `max(|dx|, |dy|, (|dx| + |dy|) / 1.3) < r` around `c`, the axes stretched by `s`.
#[derive(Clone, Copy)]
struct Octagon {
    c: [f32; 2],
    s: [f32; 2],
    r: f32,
}

impl Octagon {
    fn half(&self) -> [f32; 2] {
        [self.r * self.s[0], self.r * self.s[1]]
    }

    fn contains(&self, p: [f32; 2]) -> bool {
        let dx = ((p[0] - self.c[0]) / self.s[0]).abs();
        let dy = ((p[1] - self.c[1]) / self.s[1]).abs();
        dx.max(dy).max((dx + dy) / 1.3) < self.r
    }

    fn scaled(&self, k: f32) -> Self {
        Self {
            c: [self.c[0] * k, self.c[1] * k],
            s: self.s,
            r: self.r * k,
        }
    }
}

fn scaled(octagons: &[Octagon], k: f32) -> Vec<Octagon> {
    octagons.iter().map(|o| o.scaled(k)).collect()
}

/// The land of districts of `areas` (m²) around `seeds` (from [`seeds`]): three overlapping
/// octagons per district, closed, without holes and in one piece, scaled so its area is about
/// `Σ areas`. The field keeps `margin` metres of room around the land's bounding box for the
/// shore. `seeds` are moved into the field's frame (metres).
pub(crate) fn land(
    areas: &[f32],
    seeds: &mut [[f32; 2]],
    margin: f32,
    rng: &mut Rng,
) -> Grid<bool> {
    let areas: Vec<f32> = areas.iter().map(|a| a.max(CELL * CELL)).collect();
    let want: f32 = areas.iter().sum();
    let mut octagons = Vec::with_capacity(3 * areas.len());
    let mut before = 0.0;
    for (i, (p, a)) in seeds.iter_mut().zip(&areas).enumerate() {
        // The spiral's ring `√i` becomes the room the districts before this one take.
        let ring = if i == 0 {
            0.0
        } else {
            SPIRAL * (before / i as f32).sqrt()
        };
        before += a;
        *p = [p[0] * ring, p[1] * ring];
        let root = a.sqrt();
        for _ in 0..3 {
            let c = [
                p[0] + rng.range(-0.3, 0.3) * root,
                p[1] + rng.range(-0.3, 0.3) * root,
            ];
            let s = [rng.range(0.8, 1.25), rng.range(0.8, 1.25)];
            octagons.push(Octagon {
                c,
                s,
                r: 0.5 * root,
            });
        }
    }
    // Pull detached districts toward the core until the land is one piece: checked on the coarse
    // raster first (cheap), then on the final one.
    let mut k = 1.0f32;
    let mut pulls = 0;
    let (tight, origin) = loop {
        k = fit(&octagons, want, k);
        let shape = scaled(&octagons, k);
        let (coarse, at) = raster(&shape, COARSE);
        let (labels, count) = label(&coarse);
        if count > 1
            && pulls < MAX_PULLS
            && pull(seeds, &mut octagons, &labels, count, at, COARSE, k)
        {
            pulls += 1;
            continue;
        }
        let (fine, at) = raster(&shape, CELL);
        let (labels, count) = label(&fine);
        if count > 1 && pulls < MAX_PULLS && pull(seeds, &mut octagons, &labels, count, at, CELL, k)
        {
            pulls += 1;
            continue;
        }
        // Left off the main land now: specks of a cell or two that the closing leaves (or, past
        // `MAX_PULLS`, whatever did not join), dropped.
        let main = biggest(&labels, count);
        let data = labels.data.iter().map(|&l| l >= 0 && l == main).collect();
        break (Grid { data, ..fine }, at);
    };
    let (field, origin) = pad(tight, origin, margin);
    for p in seeds.iter_mut() {
        *p = [p[0] * k - origin[0], p[1] * k - origin[1]];
    }
    field
}

/// The overall scale that brings the land's area to `want`, fitted on a coarse raster starting
/// from `k`: the overlaps and the closing change the area.
fn fit(octagons: &[Octagon], want: f32, mut k: f32) -> f32 {
    for _ in 0..FIT_ROUNDS {
        let (coarse, _) = raster(&scaled(octagons, k), COARSE);
        let got = coarse.data.iter().filter(|&&l| l).count() as f32 * COARSE * COARSE;
        k *= (want / got.max(COARSE * COARSE)).sqrt().clamp(0.5, 2.0);
    }
    k
}

/// The label of the biggest of `count` components (`-1` when there is none).
fn biggest(labels: &Grid<i32>, count: usize) -> i32 {
    let mut size = vec![0usize; count];
    for &l in &labels.data {
        if l >= 0 {
            size[l as usize] += 1;
        }
    }
    (0..count)
        .max_by_key(|&i| (size[i], Reverse(i)))
        .map_or(-1, |i| i as i32)
}

/// Moves every district with an octagon off the biggest component toward the core, and its
/// octagons toward its seed; `false` when no district is off it. Every piece that holds an
/// octagon's centre gets pulled, the others are specks left by the closing. `labels` (with
/// `count` components) rasterises the octagons scaled by `k` in cells of `cell` metres from
/// `origin`.
fn pull(
    seeds: &mut [[f32; 2]],
    octagons: &mut [Octagon],
    labels: &Grid<i32>,
    count: usize,
    origin: [f32; 2],
    cell: f32,
    k: f32,
) -> bool {
    let main = biggest(labels, count);
    let on_main = |c: [f32; 2]| {
        let x = ((c[0] * k - origin[0]) / cell) as usize;
        let y = ((c[1] * k - origin[1]) / cell) as usize;
        x < labels.w && y < labels.h && labels.get(x, y) == main
    };
    let mut moved = false;
    for (seed, patch) in seeds.iter_mut().zip(octagons.chunks_mut(3)) {
        if patch.iter().all(|o| on_main(o.c)) {
            continue;
        }
        moved = true;
        let d = [-PULL * seed[0], -PULL * seed[1]];
        *seed = [seed[0] + d[0], seed[1] + d[1]];
        // The district's own octagons close up too (the core's can only do that).
        for o in patch {
            let c = [o.c[0] + d[0], o.c[1] + d[1]];
            o.c = [
                c[0] + PULL * (seed[0] - c[0]),
                c[1] + PULL * (seed[1] - c[1]),
            ];
        }
    }
    moved
}

/// The closed, hole-free union of `octagons` on a raster of `cell` metres just big enough for
/// it, and the raster's origin in the octagons' frame.
fn raster(octagons: &[Octagon], cell: f32) -> (Grid<bool>, [f32; 2]) {
    let (mut lo, mut hi) = ([f32::INFINITY; 2], [f32::NEG_INFINITY; 2]);
    for o in octagons {
        let h = o.half();
        for a in 0..2 {
            lo[a] = lo[a].min(o.c[a] - h[a]);
            hi[a] = hi[a].max(o.c[a] + h[a]);
        }
    }
    // Room for the closing's dilation.
    let pad = (CLOSING / cell).ceil() as usize + 1;
    let origin = [lo[0] - pad as f32 * cell, lo[1] - pad as f32 * cell];
    let (w, h) = (
        ((hi[0] - lo[0]) / cell).ceil() as usize + 2 * pad,
        ((hi[1] - lo[1]) / cell).ceil() as usize + 2 * pad,
    );
    let mut tight = Grid::new(w, h, false);
    for o in octagons {
        let hf = o.half();
        let cells = |v: f32, a: usize| ((v - origin[a]) / cell).floor().max(0.0) as usize;
        let (x0, x1) = (
            cells(o.c[0] - hf[0], 0),
            cells(o.c[0] + hf[0], 0).min(w - 1),
        );
        let (y0, y1) = (
            cells(o.c[1] - hf[1], 1),
            cells(o.c[1] + hf[1], 1).min(h - 1),
        );
        for y in y0..=y1 {
            for x in x0..=x1 {
                let p = [
                    origin[0] + (x as f32 + 0.5) * cell,
                    origin[1] + (y as f32 + 0.5) * cell,
                ];
                if o.contains(p) {
                    tight.set(x, y, true);
                }
            }
        }
    }
    (fill_holes(&close(&tight, CLOSING / cell)), origin)
}

/// `tight` (at `origin`, in cells of `CELL`) with `margin` metres of empty field on every side.
fn pad(tight: Grid<bool>, origin: [f32; 2], margin: f32) -> (Grid<bool>, [f32; 2]) {
    let room = (margin / CELL).ceil() as usize;
    if room == 0 {
        return (tight, origin);
    }
    let (w, h) = (tight.w, tight.h);
    let mut field = Grid::new(w + 2 * room, h + 2 * room, false);
    for y in 0..h {
        let at = field.idx(room, y + room);
        field.data[at..at + w].copy_from_slice(&tight.data[y * w..(y + 1) * w]);
    }
    let shift = room as f32 * CELL;
    (field, [origin[0] - shift, origin[1] - shift])
}

#[cfg(test)]
#[path = "land_tests.rs"]
mod tests;
