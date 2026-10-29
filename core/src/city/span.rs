//! The bridges between the islands of the archipelago: gate to gate, straight out, one turn
//! onto a multiple of 45°, straight in.

use super::archipelago::{WORLD_CELL, World, samples, shape};
use super::map::{Gate, Island};
use std::f64::consts::FRAC_1_SQRT_2;

/// A bridge leaves its gate and reaches the other one straight for at least this far, metres.
const LEAVE: f64 = 30.0;
/// A middle run shorter than this, but not nil, is a near miss and left out, metres.
const SHORT: f64 = 1.0;
/// The eight directions a bridge's runs can take.
const DIRS: [[f64; 2]; 8] = [
    [1.0, 0.0],
    [FRAC_1_SQRT_2, FRAC_1_SQRT_2],
    [0.0, 1.0],
    [-FRAC_1_SQRT_2, FRAC_1_SQRT_2],
    [-1.0, 0.0],
    [-FRAC_1_SQRT_2, -FRAC_1_SQRT_2],
    [0.0, -1.0],
    [FRAC_1_SQRT_2, -FRAC_1_SQRT_2],
];

/// A bridge from gate `a` to gate `b`, each `(island, gate node)`, `a`'s island the lower; its
/// points run from `a`'s node to `b`'s in world metres. Its deck stands on `level`.
#[derive(Clone, Debug, PartialEq)]
pub struct Bridge {
    pub a: (usize, u32),
    pub b: (usize, u32),
    pub points: Vec<[f32; 2]>,
    pub level: u8,
}

/// A bridge for every pair of `islands` (moved by `offsets`, see [`super::place`]) whose gates
/// face each other and can be joined without passing over land: none at all of another island,
/// and of its own two islands only on the straight from or to their gates. Each takes the
/// shortest such path `a + s·da`, then a run along one of the eight directions, then
/// `b + t·db` back to `b` (`s, t ≥ LEAVE`; `s = t` where that works, else one of them
/// `LEAVE`). A bridge stands on the lowest level none of the earlier ones it crosses takes.
pub fn bridges(islands: &[&Island], offsets: &[[f32; 2]]) -> Vec<Bridge> {
    let shapes: Vec<_> = (islands.iter().zip(offsets))
        .map(|(s, &o)| shape(s, o))
        .collect();
    if shapes.len() < 2 {
        return Vec::new();
    }
    let world = World::new(&shapes, 2.0 * WORLD_CELL);
    let mut out = Vec::new();
    for i in 0..shapes.len() {
        for j in i + 1..shapes.len() {
            // Neighbours are counted without the island itself.
            let (Some(ga), Some(gb)) = (facing(islands[i], j - 1), facing(islands[j], i)) else {
                continue;
            };
            let end = |k: usize, g: &Gate| {
                let n = islands[k].nodes[g.node as usize];
                [n[0] + offsets[k][0], n[1] + offsets[k][1]]
            };
            let (a, b) = (end(i, ga), end(j, gb));
            // Over its own islands only on the straight from or to their gates.
            let free = |first: bool, last: bool, p: [f32; 2]| {
                let own = |k: usize| (k == i && first) || (k == j && last);
                world.around(p).iter().all(|&k| k.is_none_or(own))
            };
            if let Some(points) = route(a, ga.dir, b, gb.dir, free) {
                out.push(Bridge {
                    a: (i, ga.node),
                    b: (j, gb.node),
                    points,
                    level: 0,
                });
            }
        }
    }
    for k in 0..out.len() {
        let taken: Vec<u8> = (0..k)
            .filter(|&e| crosses(&out[e].points, &out[k].points))
            .map(|e| out[e].level)
            .collect();
        out[k].level = (0..u8::MAX).find(|l| !taken.contains(l)).unwrap_or(u8::MAX);
    }
    out
}

/// The first gate of `island` that faces its neighbour `n`.
fn facing(island: &Island, n: usize) -> Option<&Gate> {
    (island.gates.iter()).find(|g| g.neighbours.contains(&(n as u32)))
}

/// The shortest path from `a` out along `da`, one run, then in to `b` against `db`, every
/// point of which (every `WORLD_CELL`) is `free(on the first run, on the last run, point)`.
fn route(
    a: [f32; 2],
    da: [f32; 2],
    b: [f32; 2],
    db: [f32; 2],
    free: impl Fn(bool, bool, [f32; 2]) -> bool,
) -> Option<Vec<[f32; 2]>> {
    let (a, b) = (a.map(f64::from), b.map(f64::from));
    let (da, db) = (snap(da), snap(db));
    let d = [b[0] - a[0], b[1] - a[1]];
    let mut best: Option<(f64, Vec<[f32; 2]>)> = None;
    for m in DIRS {
        let (ca, cb, c0) = (cross(da, m), cross(db, m), cross(d, m));
        // The middle run lies along `m` where `c0 + t·cb − s·ca = 0`.
        let tries = [
            solve(cb - ca, -c0).map(|s| (s, s)),
            solve(cb, LEAVE * ca - c0).map(|t| (LEAVE, t)),
            solve(ca, c0 + LEAVE * cb).map(|s| (s, LEAVE)),
        ];
        let found = (tries.into_iter().flatten())
            .filter_map(|(s, t)| path(a, da, b, db, m, s, t))
            .find(|(_, p)| {
                let last = p.len() - 2;
                (p.windows(2).enumerate()).all(|(r, w)| {
                    samples(w, false)
                        .into_iter()
                        .all(|q| free(r == 0, r == last, q))
                })
            });
        if let Some((len, p)) = found
            && best.as_ref().is_none_or(|(l, _)| len < *l - 1e-6)
        {
            best = Some((len, p));
        }
    }
    best.map(|(_, p)| p)
}

/// `x` with `k · x = v`; `LEAVE` when any `x` will do.
fn solve(k: f64, v: f64) -> Option<f64> {
    if k.abs() > 1e-9 {
        Some(v / k)
    } else {
        (v.abs() < 1e-6).then_some(LEAVE)
    }
}

/// The path `a`, `a + s·da`, on along `m`, `b + t·db`, `b` and its length, if both straights
/// are long enough, the middle run does not go back, and no run turns right round.
fn path(
    a: [f64; 2],
    da: [f64; 2],
    b: [f64; 2],
    db: [f64; 2],
    m: [f64; 2],
    s: f64,
    t: f64,
) -> Option<(f64, Vec<[f32; 2]>)> {
    if s < LEAVE - 1e-6 || t < LEAVE - 1e-6 {
        return None;
    }
    let p = [a[0] + s * da[0], a[1] + s * da[1]];
    let u = (b[0] + t * db[0] - p[0]) * m[0] + (b[1] + t * db[1] - p[1]) * m[1];
    let u = if u.abs() < 1e-6 { 0.0 } else { u };
    if u < 0.0 || (u > 0.0 && u < SHORT) {
        return None;
    }
    let mut runs = vec![da];
    if u > 0.0 {
        runs.push(m);
    }
    runs.push([-db[0], -db[1]]);
    if runs
        .windows(2)
        .any(|w| w[0][0] * w[1][0] + w[0][1] * w[1][1] < -1.0 + 1e-6)
    {
        return None;
    }
    let q = [p[0] + u * m[0], p[1] + u * m[1]];
    let mut points = vec![a, p];
    // A middle run along `da` goes straight on from the first.
    if u > 0.0 && cross(da, m).abs() < 1e-9 {
        points.pop();
    }
    if u > 0.0 {
        points.push(q);
    }
    points.push(b);
    let to32 = |p: [f64; 2]| [p[0] as f32, p[1] as f32];
    Some((s + u + t, points.into_iter().map(to32).collect()))
}

/// The direction of `DIRS` nearest to `d`.
fn snap(d: [f32; 2]) -> [f64; 2] {
    let along = |m: &[f64; 2]| f64::from(d[0]) * m[0] + f64::from(d[1]) * m[1];
    DIRS.into_iter()
        .max_by(|p, q| along(p).total_cmp(&along(q)))
        .unwrap_or(DIRS[0])
}

fn cross(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

/// Whether a run of `x` crosses a run of `y` at a point inside both.
fn crosses(x: &[[f32; 2]], y: &[[f32; 2]]) -> bool {
    let side = |o: [f32; 2], p: [f32; 2], q: [f32; 2]| {
        (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    };
    x.windows(2).any(|s| {
        y.windows(2).any(|t| {
            side(s[0], s[1], t[0]) * side(s[0], s[1], t[1]) < 0.0
                && side(t[0], t[1], s[0]) * side(t[0], t[1], s[1]) < 0.0
        })
    })
}
