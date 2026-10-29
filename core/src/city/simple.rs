//! The simple shapes of a bridge between two gates: straight out, one run along a multiple of
//! 45°, straight in; and a jog where the gates face each other a little off line.

use super::path::simplify;
use std::f64::consts::{FRAC_1_SQRT_2, SQRT_2};

/// A bridge leaves its gate and reaches the other one straight for at least this far, metres.
pub(crate) const LEAVE: f64 = 30.0;
/// A run shorter than this, but not nil, is a near miss and left out: its angle would not
/// survive `f32` far out, metres.
pub(crate) const SHORT: f64 = 4.0;
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
        // The middle run lies along `m` where `c0 + t·cb − s·ca = 0`; it is
        // `d·m + t·(db·m) − s·(da·m)` long.
        let along = |v: [f64; 2]| v[0] * m[0] + v[1] * m[1];
        let shortest = [[-ca, cb], [-along(da), along(db)]];
        let tries = [
            solve(cb - ca, -c0, least.0.max(least.1)).map(|s| (s, s)),
            solve(cb, least.0 * ca - c0, least.1).map(|t| (least.0, t)),
            solve(ca, c0 + least.1 * cb, least.0).map(|s| (s, least.1)),
            // The straights as long as they go with the middle run as short as a run can be.
            solve2(shortest, [-c0, SHORT - along(d)]),
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

/// `(s, t)` with `k · (s, t) = v`, if the rows of `k` are independent.
fn solve2([[k0, k1], [k2, k3]]: [[f64; 2]; 2], [v, w]: [f64; 2]) -> Option<(f64, f64)> {
    let det = k0 * k3 - k1 * k2;
    (det.abs() > 1e-9).then(|| ((v * k3 - k1 * w) / det, (k0 * w - v * k2) / det))
}

/// The path `a`, `a + s·da`, on along `m`, `b + t·db`, `b` (from `[a, da, b, db, m]`) and its
/// length, if its straights are at least `least`, every run is nil or at least `SHORT`, the
/// middle one does not go back, and no run turns more than 45° from the one before.
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
    // Unit runs along `DIRS`: those 45° apart are `cos 45°` along each other, the others 0 or less.
    if (runs.windows(2)).any(|w| w[0][0] * w[1][0] + w[0][1] * w[1][1] < 0.5) {
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

/// Where gates `a` and `b` face each other (`db = −da`) but `b` lies off `a`'s straight by less
/// than a diagonal run of `SHORT` makes up: out along `da` (at least `least.0`), a diagonal
/// towards `b`'s side, `SHORT` on, a diagonal of `SHORT` back, in to `b` (at least `least.1`).
/// The first diagonal is longer by what makes up the offset; the jog lies midway where the
/// straights allow. `None` where `ok` refuses it.
/// The jog is two 45° kinks `SHORT` apart: an S a few metres wide, visible in a 16 m deck.
pub(crate) fn jog(
    a: [f32; 2],
    da: [f32; 2],
    b: [f32; 2],
    db: [f32; 2],
    least: (f64, f64),
    ok: impl Fn(&[[f32; 2]]) -> bool,
) -> Option<Vec<[f32; 2]>> {
    let (a, b, da, db) = (a.map(f64::from), b.map(f64::from), snap(da), snap(db));
    let d = [b[0] - a[0], b[1] - a[1]];
    let (along, off) = (d[0] * da[0] + d[1] * da[1], cross(da, d));
    let facing = da[0] * db[0] + da[1] * db[1] < -1.0 + 1e-9;
    if !facing || off.abs() < 1e-6 || off.abs() * SQRT_2 >= SHORT {
        return None;
    }
    // Across towards `b`'s side, and back.
    let n = [-da[1] * off.signum(), da[0] * off.signum()];
    let diagonal = |k: f64| {
        [
            (da[0] + k * n[0]) * FRAC_1_SQRT_2,
            (da[1] + k * n[1]) * FRAC_1_SQRT_2,
        ]
    };
    let (out, back) = (
        (SHORT + SQRT_2 * off.abs(), diagonal(1.0)),
        (SHORT, diagonal(-1.0)),
    );
    let middle = (out.0 + back.0) * FRAC_1_SQRT_2 + SHORT;
    let s = ((along - middle) / 2.0).max(least.0);
    if s < least.0 - 1e-6 || along - middle - s < least.1 - 1e-6 {
        return None;
    }
    let step = |p: [f64; 2], (l, e): (f64, [f64; 2])| [p[0] + l * e[0], p[1] + l * e[1]];
    let p1 = step(a, (s, da));
    let p2 = step(p1, out);
    let p3 = step(p2, (SHORT, da));
    let p4 = step(p3, back);
    let to32 = |p: [f64; 2]| [p[0] as f32, p[1] as f32];
    let points: Vec<[f32; 2]> = [a, p1, p2, p3, p4, b].map(to32).to_vec();
    ok(&points).then_some(points)
}

#[cfg(test)]
#[path = "simple_tests.rs"]
mod tests;
