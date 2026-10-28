//! Cheapest paths over a cost raster and their conversion to 45-degree polylines.

use super::grid::Grid;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

const MOVES: [(isize, isize); 8] = [
    (1, 0),
    (-1, 0),
    (0, 1),
    (0, -1),
    (1, 1),
    (1, -1),
    (-1, 1),
    (-1, -1),
];

/// Dijkstra over the 8 neighbours from `from`. A step costs `length * (cost[a] + cost[b]) / 2`
/// (length 1 or sqrt 2). Cells with infinite cost are walls; a diagonal step is not allowed
/// between two walls' corners (either orthogonal neighbour being a wall forbids it). Costs must be
/// non-negative. Returns each cell's predecessor index; `u32::MAX` marks `from` and unreachable
/// cells.
pub(crate) fn shortest(cost: &Grid<f32>, from: (usize, usize)) -> Grid<u32> {
    let (w, h) = (cost.w, cost.h);
    let mut pred = Grid::new(w, h, u32::MAX);
    let mut best = vec![f32::INFINITY; w * h];
    let mut heap: BinaryHeap<Reverse<(u32, u32)>> = BinaryHeap::new();
    let start = cost.idx(from.0, from.1);
    best[start] = 0.0;
    // Non-negative f32 order equals the order of their bit patterns.
    heap.push(Reverse((0f32.to_bits(), start as u32)));
    while let Some(Reverse((bits, i))) = heap.pop() {
        let i = i as usize;
        let d = f32::from_bits(bits);
        if d > best[i] {
            continue;
        }
        let (x, y) = ((i % w) as isize, (i / w) as isize);
        for (dx, dy) in MOVES {
            let (nx, ny) = (x + dx, y + dy);
            if nx < 0 || ny < 0 || nx >= w as isize || ny >= h as isize {
                continue;
            }
            let n = ny as usize * w + nx as usize;
            if cost.data[n].is_infinite() {
                continue;
            }
            let diagonal = dx != 0 && dy != 0;
            if diagonal
                && (cost.data[y as usize * w + nx as usize].is_infinite()
                    || cost.data[ny as usize * w + x as usize].is_infinite())
            {
                continue;
            }
            let len = if diagonal {
                std::f32::consts::SQRT_2
            } else {
                1.0
            };
            let nd = d + len * (cost.data[i] + cost.data[n]) * 0.5;
            if nd < best[n] {
                best[n] = nd;
                pred.data[n] = i as u32;
                heap.push(Reverse((nd.to_bits(), n as u32)));
            }
        }
    }
    pred
}

/// The path from `to` back to the start of `pred` (both ends included).
pub(crate) fn walk_back(pred: &Grid<u32>, to: (usize, usize)) -> Vec<(usize, usize)> {
    let mut i = pred.idx(to.0, to.1);
    let mut out = vec![to];
    while pred.data[i] != u32::MAX {
        i = pred.data[i] as usize;
        out.push((i % pred.w, i / pred.w));
    }
    out
}

fn sub(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] - b[0], a[1] - b[1]]
}

/// Distance from `p` to the segment `a`-`b`.
pub(crate) fn point_segment(p: [f32; 2], a: [f32; 2], b: [f32; 2]) -> f32 {
    let (ab, ap) = (sub(b, a), sub(p, a));
    let len2 = ab[0] * ab[0] + ab[1] * ab[1];
    let t = if len2 > 0.0 {
        ((ap[0] * ab[0] + ap[1] * ab[1]) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (ap[0] - t * ab[0]).hypot(ap[1] - t * ab[1])
}

/// The two ways to get from `a` to `b` with a straight piece and a diagonal piece: the corner
/// with the straight piece first, and the corner with the diagonal piece first. When the delta is
/// already a multiple of 45 degrees a corner coincides with an end.
fn corners(a: [f32; 2], b: [f32; 2]) -> [[f32; 2]; 2] {
    let [dx, dy] = sub(b, a);
    let (sx, sy) = (dx.signum(), dy.signum());
    let m = dx.abs().min(dy.abs());
    if dx.abs() >= dy.abs() {
        [[a[0] + dx - sx * m, a[1]], [a[0] + sx * m, b[1]]]
    } else {
        [[a[0], a[1] + dy - sy * m], [b[0], a[1] + sy * m]]
    }
}

/// The corner that lets `a -> corner -> b` stay within `tol` of every point of `pts`
/// (`a` and `b` being its first and last), preferring the smaller deviation.
fn fit(pts: &[[f32; 2]], tol: f32) -> Option<[f32; 2]> {
    let (a, b) = (pts[0], pts[pts.len() - 1]);
    corners(a, b)
        .into_iter()
        .filter_map(|c| {
            let dev = pts
                .iter()
                .map(|&p| point_segment(p, a, c).min(point_segment(p, c, b)))
                .fold(0.0, f32::max);
            (dev <= tol).then_some((dev, c))
        })
        .min_by(|x, y| x.0.total_cmp(&y.0))
        .map(|(_, c)| c)
}

/// Failed endpoints tolerated before a piece stops growing (feasibility is not monotone).
const LOOKAHEAD: usize = 4;
const EPS: f32 = 1e-4;

/// Replaces a polyline by one whose every segment is at a multiple of 45 degrees. It starts and
/// ends at the same points and stays within `tol` of every input point. Greedy: each step takes
/// the farthest input point reachable by a straight-plus-diagonal pair of segments, so a
/// straight 8-neighbour staircase collapses to a single diagonal.
pub(crate) fn octilinear(points: &[[f32; 2]], tol: f32) -> Vec<[f32; 2]> {
    if points.len() < 2 {
        return points.to_vec();
    }
    let mut out = vec![points[0]];
    let mut i = 0;
    while i + 1 < points.len() {
        let mut best = (i + 1, None);
        let mut misses = 0;
        for j in i + 1..points.len() {
            match fit(&points[i..=j], tol) {
                Some(c) => {
                    best = (j, Some(c));
                    misses = 0;
                }
                None => {
                    misses += 1;
                    if misses > LOOKAHEAD {
                        break;
                    }
                }
            }
        }
        out.extend(best.1);
        out.push(points[best.0]);
        i = best.0;
    }
    simplify(out)
}

/// Drops repeated points (keeping the later one, so the end stays exact) and the middle point of
/// two collinear, same-direction segments.
fn simplify(line: Vec<[f32; 2]>) -> Vec<[f32; 2]> {
    let mut out: Vec<[f32; 2]> = Vec::with_capacity(line.len());
    for p in line {
        if let Some(&last) = out.last() {
            let d = sub(p, last);
            if d[0].hypot(d[1]) <= EPS {
                if out.len() >= 2 {
                    out.pop();
                } else {
                    continue;
                }
            }
        }
        while out.len() >= 2 {
            let (u, v) = (
                sub(out[out.len() - 1], out[out.len() - 2]),
                sub(p, out[out.len() - 1]),
            );
            let cross = u[0] * v[1] - u[1] * v[0];
            let dot = u[0] * v[0] + u[1] * v[1];
            if dot > 0.0 && cross.abs() <= 1e-5 * u[0].hypot(u[1]) * v[0].hypot(v[1]) {
                out.pop();
            } else {
                break;
            }
        }
        out.push(p);
    }
    out
}

#[cfg(test)]
#[path = "path_tests.rs"]
mod tests;
