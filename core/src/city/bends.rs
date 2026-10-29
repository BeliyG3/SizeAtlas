//! The corners of a bridge: how sharp they turn, what they cost, and two turns the same way
//! drawn apart so they do not look like one.

use super::simple::{SHORT, snap};
use std::f32::consts::FRAC_PI_4;
use std::f64::consts::SQRT_2;

/// A turn of 45° costs as much as this much more bridge, metres.
pub(crate) const BEND: f32 = 30.0;
/// A run between two turns the same way is drawn out to this, metres: two turns of 45° closer
/// together look like one of 90°.
const EASE: f64 = 30.0;
/// A run is drawn out by halves down to this much, metres.
const STEP: f64 = 1.0;

pub(crate) fn length(points: &[[f32; 2]]) -> f32 {
    (points.windows(2))
        .map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1]))
        .sum()
}

/// The turn at each corner of the line `points`, radians.
fn turns(points: &[[f32; 2]]) -> impl Iterator<Item = f32> + '_ {
    points.windows(3).map(|w| {
        let u = [w[1][0] - w[0][0], w[1][1] - w[0][1]];
        let v = [w[2][0] - w[1][0], w[2][1] - w[1][1]];
        let cos = (u[0] * v[0] + u[1] * v[1]) / (u[0].hypot(u[1]) * v[0].hypot(v[1]));
        cos.clamp(-1.0, 1.0).acos()
    })
}

/// Whether the line `points` turns more than 45° at any corner.
pub(crate) fn sharp(points: &[[f32; 2]]) -> bool {
    turns(points).any(|t| t > FRAC_PI_4 + 1e-3)
}

/// What a bridge along `points` costs: its length and `BEND` per 45° it turns.
pub(crate) fn cost(points: &[[f32; 2]]) -> f32 {
    length(points) + BEND * turns(points).sum::<f32>() / FRAC_PI_4
}

/// `points` (runs along `DIRS`, 45° turns) where every run shorter than `EASE` between two
/// turns the same way is drawn out towards it as far as `ok` lets: its ends slide back along
/// the runs either side by as much each, which keep `SHORT` (the first `least.0`, the last
/// `least.1`). The runs keep their directions.
pub(crate) fn ease(
    mut points: Vec<[f32; 2]>,
    least: (f64, f64),
    ok: impl Fn(&[[f32; 2]]) -> bool,
) -> Vec<[f32; 2]> {
    let n = points.len();
    let f = |q: [f32; 2]| q.map(f64::from);
    let run = |p: &[[f32; 2]], k: usize| {
        let (a, b) = (f(p[k]), f(p[k + 1]));
        let d = [b[0] - a[0], b[1] - a[1]];
        (d[0].hypot(d[1]), snap([d[0] as f32, d[1] as f32]))
    };
    let cross = |u: [f64; 2], v: [f64; 2]| u[0] * v[1] - u[1] * v[0];
    for k in 1..n.saturating_sub(2) {
        let ((l0, d0), (l1, d1), (l2, d2)) =
            (run(&points, k - 1), run(&points, k), run(&points, k + 1));
        if l1 >= EASE || cross(d0, d1) * cross(d1, d2) <= 0.0 {
            continue;
        }
        let keep0 = if k == 1 { least.0 } else { SHORT };
        let keep2 = if k + 2 == n - 1 { least.1 } else { SHORT };
        // Both ends slide by `x`: the run grows by `√2·x` and keeps its direction.
        let mut x = ((EASE - l1) / SQRT_2).min(l0 - keep0).min(l2 - keep2);
        while x >= STEP {
            let (p, q) = (f(points[k]), f(points[k + 1]));
            let mut tried = points.clone();
            tried[k] = [(p[0] - x * d0[0]) as f32, (p[1] - x * d0[1]) as f32];
            tried[k + 1] = [(q[0] + x * d2[0]) as f32, (q[1] + x * d2[1]) as f32];
            if ok(&tried) {
                points = tried;
                break;
            }
            x /= 2.0;
        }
    }
    points
}

#[cfg(test)]
#[path = "bends_tests.rs"]
mod tests;
