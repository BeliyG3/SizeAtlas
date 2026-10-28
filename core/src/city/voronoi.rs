//! Weighted Voronoi split of a mask in the Chebyshev metric: every border runs at 0, 45 or 90
//! degrees to the frame it is computed in.

use super::CELL;
use super::grid::Grid;

/// Weights are fitted on about this many cells of the mask (every `k`-th cell along each axis);
/// the final split is done on every cell.
const SAMPLE: usize = 40_000;
/// Share of the `√target − √area` gap closed per round.
const RATE: f32 = 0.3;
/// A weight stays below this share of the distance to the nearest other seed, so a cell never
/// flows around its neighbours.
const CAP: f32 = 0.45;

/// Splits the `true` cells of `mask` among `seeds` (metres, in the grid frame): label `k` for
/// seed `k`, `-1` off the mask. Distances are Chebyshev in a frame turned by `rot`, minus a
/// per-seed weight; `rounds` rounds fit the weights so the cells approach `targets` (m², meant to
/// add up to the mask's area).
pub(crate) fn voronoi(
    mask: &Grid<bool>,
    seeds: &[[f32; 2]],
    targets: &[f32],
    rot: f32,
    rounds: usize,
) -> Grid<i32> {
    voronoi_sampled(mask, seeds, targets, rot, rounds, SAMPLE)
}

/// [`voronoi`] with the weights fitted on about `fit` cells (from `fit` to four times it, or
/// every cell of a smaller mask), for splits whose few seeds need no finer fit.
pub(crate) fn voronoi_sampled(
    mask: &Grid<bool>,
    seeds: &[[f32; 2]],
    targets: &[f32],
    rot: f32,
    rounds: usize,
    fit: usize,
) -> Grid<i32> {
    let mut out = Grid::new(mask.w, mask.h, -1);
    if seeds.is_empty() {
        return out;
    }
    let (cos, sin) = (rot.cos(), rot.sin());
    let turn = |p: [f32; 2]| [p[0] * cos + p[1] * sin, p[1] * cos - p[0] * sin];
    let at = |x: usize, y: usize| turn([(x as f32 + 0.5) * CELL, (y as f32 + 0.5) * CELL]);
    let turned: Vec<[f32; 2]> = seeds.iter().map(|&p| turn(p)).collect();
    let caps = caps(&turned);

    let cells = mask.data.iter().filter(|&&m| m).count();
    let k = ((cells / fit.max(1)) as f32).sqrt().floor().max(1.0) as usize;
    let mut sample = Vec::with_capacity(cells / (k * k) + 1);
    for y in (k / 2..mask.h).step_by(k) {
        for x in (k / 2..mask.w).step_by(k) {
            if mask.get(x, y) {
                sample.push(at(x, y));
            }
        }
    }
    let cell_area = (k as f32 * CELL).powi(2);
    let roots: Vec<f32> = targets.iter().map(|t| t.max(0.0).sqrt()).collect();
    let mut weights = vec![0.0f32; seeds.len()];
    let mut count = vec![0usize; seeds.len()];
    for _ in 0..rounds {
        count.fill(0);
        for &p in &sample {
            count[nearest(p, &turned, &weights)] += 1;
        }
        for (i, w) in weights.iter_mut().enumerate() {
            let area = (count[i] as f32 * cell_area).max(1.0);
            *w = (*w + RATE * (roots[i] - area.sqrt())).clamp(-caps[i], caps[i]);
        }
    }
    for y in 0..mask.h {
        for x in 0..mask.w {
            if mask.get(x, y) {
                out.set(x, y, nearest(at(x, y), &turned, &weights) as i32);
            }
        }
    }
    merge_pieces(&mut out, seeds.len());
    out
}

/// A cell cut by a bay of the mask can fall apart: every piece but its biggest goes to the
/// neighbouring cell it shares the longest edge with (if it touches one at all).
fn merge_pieces(labels: &mut Grid<i32>, n: usize) {
    let (w, h) = (labels.w, labels.h);
    let near = |i: usize| {
        let (x, y) = (i % w, i / w);
        [
            (x > 0).then(|| i - 1),
            (x + 1 < w).then(|| i + 1),
            (y > 0).then(|| i - w),
            (y + 1 < h).then(|| i + w),
        ]
        .into_iter()
        .flatten()
    };
    // 4-connected pieces of equal labels.
    let mut piece = vec![usize::MAX; w * h];
    let (mut size, mut owner) = (Vec::new(), Vec::new());
    let mut stack = Vec::new();
    for start in 0..w * h {
        let l = labels.data[start];
        if l < 0 || piece[start] != usize::MAX {
            continue;
        }
        let id = size.len();
        piece[start] = id;
        stack.push(start);
        let mut count = 0;
        while let Some(i) = stack.pop() {
            count += 1;
            for j in near(i) {
                if labels.data[j] == l && piece[j] == usize::MAX {
                    piece[j] = id;
                    stack.push(j);
                }
            }
        }
        size.push(count);
        owner.push(l as usize);
    }
    let mut main = vec![usize::MAX; n];
    for (p, &l) in owner.iter().enumerate() {
        if main[l] == usize::MAX || size[p] > size[main[l]] {
            main[l] = p;
        }
    }
    if size.len() == main.iter().filter(|&&p| p != usize::MAX).count() {
        return;
    }
    // Edge length from each stray piece to each cell's main piece.
    let mut touch = vec![vec![0u32; n]; size.len()];
    for i in 0..w * h {
        let p = piece[i];
        if p == usize::MAX || main[owner[p]] == p {
            continue;
        }
        for j in near(i) {
            let q = piece[j];
            if q != usize::MAX && main[owner[q]] == q {
                touch[p][owner[q]] += 1;
            }
        }
    }
    let mut to: Vec<i32> = owner.iter().map(|&l| l as i32).collect();
    for (p, t) in touch.iter().enumerate() {
        let (best, &edge) = t
            .iter()
            .enumerate()
            .rev()
            .max_by_key(|&(_, e)| e)
            .unwrap_or((0, &0));
        if edge > 0 {
            to[p] = best as i32;
        }
    }
    for (l, &p) in labels.data.iter_mut().zip(&piece) {
        if p != usize::MAX {
            *l = to[p];
        }
    }
}

/// `CAP` times each seed's Chebyshev distance to its nearest other seed (unbounded when alone).
fn caps(seeds: &[[f32; 2]]) -> Vec<f32> {
    seeds
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let near = seeds
                .iter()
                .enumerate()
                .filter(|&(j, _)| j != i)
                .map(|(_, b)| (a[0] - b[0]).abs().max((a[1] - b[1]).abs()))
                .fold(f32::INFINITY, f32::min);
            if near.is_finite() {
                CAP * near
            } else {
                f32::MAX
            }
        })
        .collect()
}

/// The seed with the smallest weighted Chebyshev distance to `p`; ties go to the lower index.
#[inline]
fn nearest(p: [f32; 2], seeds: &[[f32; 2]], weights: &[f32]) -> usize {
    let mut best = (f32::INFINITY, 0);
    for (i, (s, w)) in seeds.iter().zip(weights).enumerate() {
        let d = (p[0] - s[0]).abs().max((p[1] - s[1]).abs()) - w;
        if d < best.0 {
            best = (d, i);
        }
    }
    best.1
}

#[cfg(test)]
#[path = "voronoi_tests.rs"]
mod tests;
