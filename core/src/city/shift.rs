//! Moving a run of a bridge sideways onto a line: its ends slide along the runs out of them,
//! or carry short ones along, so every run keeps its direction.

use super::lanes::{Line, SAME, cross, dot, f, run, sub};
use super::path::simplify;
use super::simple::SHORT;

/// A run moves at most this far across onto its lane's line, metres: a lane of runs each
/// `NEAR` from the next is wider.
const WIDE: f64 = 3.0 * super::lanes::NEAR;
/// A run's end moving onto a line carries at most this many short runs out of it along.
const CARRY: usize = 3;

/// `p` with its inner run `k` moved onto the line through `q0` along `e` (a run `lq` long), if
/// it runs beside that run (see [`super::lanes::align`]).
pub(crate) fn onto(
    p: &[[f32; 2]],
    k: usize,
    (q0, e, lq): ([f32; 2], [f64; 2], f64),
    least: (f64, f64),
) -> Option<Line> {
    let (d, _) = run(p[k], p[k + 1]);
    let aside = cross(e, sub(f(p[k]), f(q0)));
    if cross(e, d).abs() > 1e-9 || aside.abs() <= SAME || aside.abs() > WIDE {
        return None;
    }
    let along = |v: [f32; 2]| dot(e, sub(f(v), f(q0)));
    let (a0, a1) = (along(p[k]), along(p[k + 1]));
    if lq.min(a0.max(a1)) - a0.min(a1).max(0.0) <= SAME {
        return None;
    }
    let (back, ahead) = (
        end(p, k, true, e, aside, least)?,
        end(p, k + 1, false, e, aside, least)?,
    );
    let mut moved = p.to_vec();
    for &(at, q) in back.iter().chain(&ahead) {
        moved[at] = q;
    }
    let (from, to) = (f(moved[k]), f(moved[k + 1]));
    if dot(sub(to, from), d) < SHORT - 1e-6 {
        return None;
    }
    Some(simplify(moved))
}

/// The points that move the end `c` of a run `aside` off the line along `e` onto it, the end
/// before it (`back`) or after: `c` slides along the run out of it, which keeps `SHORT` (the
/// straight of a gate its `least`) or shrinks away; else the runs out of it are carried, whole,
/// along the first one beyond that keeps as much (up to `CARRY` runs). The runs keep their
/// directions.
fn end(
    p: &[[f32; 2]],
    c: usize,
    back: bool,
    e: [f64; 2],
    aside: f64,
    least: (f64, f64),
) -> Option<Vec<(usize, [f32; 2])>> {
    let last = p.len() - 1;
    let next = |i: usize| {
        if back {
            i.checked_sub(1)
        } else {
            (i < last).then_some(i + 1)
        }
    };
    let keep = |to: usize| match to {
        0 => least.0,
        t if t == last => least.1,
        _ => SHORT,
    };
    let shift = |q: [f32; 2], t: f64, w: [f64; 2]| {
        [
            (f64::from(q[0]) + t * w[0]) as f32,
            (f64::from(q[1]) + t * w[1]) as f32,
        ]
    };
    // The corners carried so far (`c` and those up to `at`), then the run out of `at` to `o`.
    let (mut carried, mut at) = (vec![c], c);
    for _ in 0..=CARRY {
        let o = next(at)?;
        // Along the run from `at` to `o` by `t`: `aside + t·(e × w) = 0`.
        let (w, l) = run(p[at], p[o]);
        let cw = cross(e, w);
        if cw.abs() > 1e-9 {
            let t = -aside / cw;
            if carried.len() == 1 && o != 0 && o != last && (l - t).abs() < SAME {
                return Some(vec![(c, p[o])]);
            }
            if l - t >= keep(o) - 1e-6 {
                return Some(carried.iter().map(|&i| (i, shift(p[i], t, w))).collect());
            }
        }
        carried.push(o);
        at = o;
    }
    None
}
