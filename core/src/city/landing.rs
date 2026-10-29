//! Where a way over the sea lands on the straights out of its gates.

use super::coast::{CLEAR, Coast};
use super::simple::snap;
use super::span::{LEAVE, SHORT};

/// A gate's straight is not followed past this to where it keeps clear of its coast, metres.
const FAR: f64 = 300.0;

/// How far the straight from gate `p` along `d` runs over or near its island's `coast` (within
/// `CLEAR`), but at least `LEAVE`, metres: a bridge turns off it no sooner.
pub(crate) fn clears(coast: &Coast, p: [f32; 2], d: [f32; 2]) -> f64 {
    let d = snap(d);
    let at = |s: f64| {
        [
            (f64::from(p[0]) + s * d[0]) as f32,
            (f64::from(p[1]) + s * d[1]) as f32,
        ]
    };
    let mut s = LEAVE;
    while s < FAR && coast.near(at(s), CLEAR) {
        s += 1.0;
    }
    s
}

/// Where the first (`first`) or the last run of `way` runs alongside the straight through `p`
/// along `d`, a few metres off it, moves the corner after (before) it along the next (previous)
/// run onto that straight, so the gate's straight goes on into the way without a jog.
pub(crate) fn onto(way: &mut [[f32; 2]], p: [f32; 2], d: [f32; 2], first: bool) {
    let n = way.len();
    if n < 3 {
        return;
    }
    let (end, corner, next) = if first {
        (0, 1, 2)
    } else {
        (n - 1, n - 2, n - 3)
    };
    let f = |q: [f32; 2]| q.map(f64::from);
    let (d, p, end, corner, next) = (snap(d), f(p), f(way[end]), f(way[corner]), f(way[next]));
    let cross = |a: [f64; 2], b: [f64; 2]| a[0] * b[1] - a[1] * b[0];
    let sub = |a: [f64; 2], b: [f64; 2]| [a[0] - b[0], a[1] - b[1]];
    let run = sub(corner, end);
    let along = sub(corner, next);
    let len = along[0].hypot(along[1]);
    if cross(run, d).abs() > 1e-6 * run[0].hypot(run[1]) || len < 1e-6 {
        return;
    }
    // `corner` slides to `next + u · e`, on the straight.
    let e = [along[0] / len, along[1] / len];
    let k = cross(e, d);
    if k.abs() < 1e-9 {
        return;
    }
    let u = -cross(sub(next, p), d) / k;
    if u >= SHORT {
        let c = if first { 1 } else { n - 2 };
        way[c] = [(next[0] + u * e[0]) as f32, (next[1] + u * e[1]) as f32];
    }
}

/// Where the straights from gates `a` and `b` (node, outward direction) cross, both at least `LEAVE` out of their gates.
pub(crate) fn meet(
    (a, da): ([f32; 2], [f32; 2]),
    (b, db): ([f32; 2], [f32; 2]),
) -> Option<[f32; 2]> {
    let (a, b, da, db) = (a.map(f64::from), b.map(f64::from), snap(da), snap(db));
    let cross = |u: [f64; 2], v: [f64; 2]| u[0] * v[1] - u[1] * v[0];
    let (k, d) = (cross(da, db), [b[0] - a[0], b[1] - a[1]]);
    if k.abs() < 1e-9 {
        return None;
    }
    // `a + s·da = b + t·db`.
    let (s, t) = (cross(d, db) / k, cross(d, da) / k);
    let out = s >= LEAVE - 1e-6 && t >= LEAVE - 1e-6;
    out.then(|| [(a[0] + s * da[0]) as f32, (a[1] + s * da[1]) as f32])
}
