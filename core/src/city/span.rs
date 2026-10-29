//! The bridges between the islands of the archipelago, gate to gate: straight out, one turn
//! onto a multiple of 45°, straight in; round the islands over the open sea where that shape
//! cannot keep off them.

use super::chart::shape;
use super::coast::{Coast, keeps_clear};
use super::gates::segments_apart;
use super::map::{Gate, Island};
use super::path::simplify;
use super::seaway::Sea;
use std::f64::consts::FRAC_1_SQRT_2;

/// A bridge leaves its gate and reaches the other one straight for at least this far, metres.
pub(crate) const LEAVE: f64 = 30.0;
/// A run shorter than this, but not nil, is a near miss and left out: its angle would not
/// survive `f32` far out, metres.
pub(crate) const SHORT: f64 = 4.0;
/// Bridges nearer than a deck's width and a margin stand on different levels, metres.
const APART: f32 = 16.0 + 4.0;
/// The eight directions a bridge's runs can take, `k · 45°` with `y` down.
pub(crate) const DIRS: [[f64; 2]; 8] = [
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
/// face each other, keeping `CLEAR` from every outline but on its way out of its gates (see
/// [`keeps_clear`]). It takes the shortest path `a + s·da`, a run along one of the eight
/// directions, `b + t·db` back to `b` (`s, t ≥ LEAVE`; `s = t` where that works, else one of
/// them `LEAVE`); where none keeps clear, the way of [`Sea::route`]; with neither, none. A
/// bridge stands on the lowest level none of the earlier ones it [`conflicts`] with takes.
pub fn bridges(islands: &[&Island], offsets: &[[f32; 2]]) -> Vec<Bridge> {
    let shapes: Vec<_> = (islands.iter().zip(offsets))
        .map(|(s, &o)| shape(s, o))
        .collect();
    if shapes.len() < 2 {
        return Vec::new();
    }
    let coasts: Vec<Coast> = shapes.iter().map(|s| Coast::new(s)).collect();
    // The open sea, charted for the first bridge that needs it.
    let mut sea: Option<Sea> = None;
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
            let clear = |p: &[[f32; 2]]| keeps_clear(&coasts, p, Some(i), Some(j));
            let points = route(a, ga.dir, b, gb.dir, (LEAVE, LEAVE), clear).or_else(|| {
                let sea = sea.get_or_insert_with(|| Sea::new(&shapes));
                sea.route(&coasts, (i, a, ga.dir), (j, b, gb.dir))
            });
            if let Some(points) = points {
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
            .filter(|&e| conflicts(&out[e], &out[k]))
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

/// The shortest path `ok` takes from `a` out along `da` (at least `least.0`), one run, then in to
/// `b` against `db` (at least `least.1`). A straight of 0 leaves it out.
pub(crate) fn route(
    a: [f32; 2],
    da: [f32; 2],
    b: [f32; 2],
    db: [f32; 2],
    least: (f64, f64),
    ok: impl Fn(&[[f32; 2]]) -> bool,
) -> Option<Vec<[f32; 2]>> {
    let (a, b) = (a.map(f64::from), b.map(f64::from));
    let (da, db) = (snap(da), snap(db));
    let d = [b[0] - a[0], b[1] - a[1]];
    let mut best: Option<(f64, Vec<[f32; 2]>)> = None;
    for m in DIRS {
        let (ca, cb, c0) = (cross(da, m), cross(db, m), cross(d, m));
        // The middle run lies along `m` where `c0 + t·cb − s·ca = 0`.
        let tries = [
            solve(cb - ca, -c0, least.0.max(least.1)).map(|s| (s, s)),
            solve(cb, least.0 * ca - c0, least.1).map(|t| (least.0, t)),
            solve(ca, c0 + least.1 * cb, least.0).map(|s| (s, least.1)),
        ];
        let found = (tries.into_iter().flatten())
            .filter_map(|(s, t)| path([a, da, b, db, m], (s, t), least))
            .find(|(_, p)| ok(p));
        if let Some((len, p)) = found
            && best.as_ref().is_none_or(|(l, _)| len < *l - 1e-6)
        {
            best = Some((len, p));
        }
    }
    best.map(|(_, p)| p)
}

/// `x` with `k · x = v`; `any` when every `x` will do.
fn solve(k: f64, v: f64, any: f64) -> Option<f64> {
    if k.abs() > 1e-9 {
        Some(v / k)
    } else {
        (v.abs() < 1e-6).then_some(any)
    }
}

/// The path `a`, `a + s·da`, on along `m`, `b + t·db`, `b` (from `[a, da, b, db, m]`) and its
/// length, if its straights are at least `least`, every run is nil or at least `SHORT`, the
/// middle one does not go back, and no run turns right round.
fn path(
    [a, da, b, db, m]: [[f64; 2]; 5],
    (s, t): (f64, f64),
    least: (f64, f64),
) -> Option<(f64, Vec<[f32; 2]>)> {
    let p = [a[0] + s * da[0], a[1] + s * da[1]];
    let u = (b[0] + t * db[0] - p[0]) * m[0] + (b[1] + t * db[1] - p[1]) * m[1];
    let nil = |x: f64| x.abs() < 1e-6;
    let fits = |x: f64, low: f64| x >= low - 1e-6 && (nil(x) || x >= SHORT);
    if !fits(s, least.0) || !fits(t, least.1) || !fits(u, 0.0) {
        return None;
    }
    let runs: Vec<[f64; 2]> = [(s, da), (u, m), (t, [-db[0], -db[1]])]
        .into_iter()
        .filter_map(|(x, d)| (!nil(x)).then_some(d))
        .collect();
    if (runs.windows(2)).any(|w| w[0][0] * w[1][0] + w[0][1] * w[1][1] < -1.0 + 1e-6) {
        return None;
    }
    let q = [p[0] + u * m[0], p[1] + u * m[1]];
    let to32 = |p: [f64; 2]| [p[0] as f32, p[1] as f32];
    Some((
        s + u + t,
        simplify(vec![to32(a), to32(p), to32(q), to32(b)]),
    ))
}

/// The direction of `DIRS` nearest to `d`.
pub(crate) fn snap(d: [f32; 2]) -> [f64; 2] {
    let along = |m: &[f64; 2]| f64::from(d[0]) * m[0] + f64::from(d[1]) * m[1];
    DIRS.into_iter()
        .max_by(|p, q| along(p).total_cmp(&along(q)))
        .unwrap_or(DIRS[0])
}

fn cross(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

/// Whether bridges `x` and `y` cross or come within `APART`, but for their two runs at a gate
/// both take, against each other (they fork there).
fn conflicts(x: &Bridge, y: &Bridge) -> bool {
    let skip: Vec<(usize, usize)> = [x.a, x.b]
        .into_iter()
        .filter_map(|g| Some((gate_run(x, g)?, gate_run(y, g)?)))
        .collect();
    (0..x.points.len() - 1).any(|r| {
        (0..y.points.len() - 1).any(|q| {
            let (s, t) = (&x.points[r..r + 2], &y.points[q..q + 2]);
            !skip.contains(&(r, q)) && segments_apart(s[0], s[1], t[0], t[1]) < APART
        })
    })
}

/// The run of `b` (its first point's index) at its gate `g`, if `g` is one of its gates.
fn gate_run(b: &Bridge, g: (usize, u32)) -> Option<usize> {
    (b.a == g)
        .then_some(0)
        .or((b.b == g).then(|| b.points.len() - 2))
}

#[cfg(test)]
#[path = "span_tests.rs"]
mod tests;
