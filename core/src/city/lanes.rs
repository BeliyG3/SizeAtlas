//! Lanes over the sea: runs of the bridges that go the same way side by side, within a deck
//! and a margin, are moved onto one line.

use super::bends::sharp;
use super::shift::onto;
use super::simple::{DIRS, snap as heading};

/// Runs this near side by side are one lane, metres: a deck's width and a margin.
pub(crate) const NEAR: f64 = 16.0 + 4.0;
/// Points this near are one, metres (as the frontend keys them).
pub(crate) const SAME: f64 = 0.01;

pub(crate) type Line = Vec<[f32; 2]>;

pub(crate) fn f(p: [f32; 2]) -> [f64; 2] {
    p.map(f64::from)
}

pub(crate) fn sub(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] - b[0], a[1] - b[1]]
}

pub(crate) fn cross(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

pub(crate) fn dot(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

/// The direction of `DIRS` from `a` to `b`, and how far.
pub(crate) fn run(a: [f32; 2], b: [f32; 2]) -> ([f64; 2], f64) {
    let d = sub(f(b), f(a));
    (heading([d[0] as f32, d[1] as f32]), d[0].hypot(d[1]))
}

/// A run: its line and index there, its axis (an index of `DIRS` below 4, either way along),
/// how far its line lies across the axis, the stretch along it, and whether it is a straight
/// out of a gate (it does not move).
struct Run {
    line: usize,
    k: usize,
    axis: usize,
    across: f64,
    lo: f64,
    hi: f64,
    gate: bool,
}

fn runs(lines: &[Line]) -> Vec<Run> {
    let mut out = Vec::new();
    for (line, p) in lines.iter().enumerate() {
        for k in 0..p.len().saturating_sub(1) {
            let (d, _) = run(p[k], p[k + 1]);
            let axis = DIRS.iter().position(|&m| m == d).unwrap_or(0) % 4;
            let e = DIRS[axis];
            let (a, b) = (dot(e, f(p[k])), dot(e, f(p[k + 1])));
            out.push(Run {
                line,
                k,
                axis,
                across: cross(e, f(p[k])),
                lo: a.min(b),
                hi: a.max(b),
                gate: k == 0 || k + 2 == p.len(),
            });
        }
    }
    out
}

/// One round: the runs of `lines` grouped into lanes (same axis, lines within `NEAR`, side by
/// side over a stretch, one with the next), and the runs of each lane moved onto one line (see
/// [`onto`]), where `ok(line, points)` takes the result and no corner turns more than 45°.
/// Whether any moved.
pub(crate) fn align(
    lines: &mut [Line],
    least: &[(f64, f64)],
    ok: impl Fn(usize, &[[f32; 2]]) -> bool,
) -> bool {
    let all = runs(lines);
    let mut lane: Vec<usize> = (0..all.len()).collect();
    for x in 0..all.len() {
        for y in 0..x {
            let (r, s) = (&all[x], &all[y]);
            let beside = r.axis == s.axis
                && (r.across - s.across).abs() <= NEAR
                && r.hi.min(s.hi) - r.lo.max(s.lo) > SAME;
            if beside && lane[x] != lane[y] {
                let (keep, gone) = (lane[x].min(lane[y]), lane[x].max(lane[y]));
                lane.iter_mut()
                    .filter(|l| **l == gone)
                    .for_each(|l| *l = keep);
            }
        }
    }
    let mut moved = false;
    for first in 0..all.len() {
        let members: Vec<&Run> = (0..all.len())
            .filter(|&r| lane[r] == first)
            .map(|r| &all[r])
            .collect();
        // The line of the lane: the one the most of its runs can move onto (all of those on it
        // stay, a straight out of a gate cannot move); of equal ones, the earliest.
        let mut lanes: Vec<f64> = Vec::new();
        for r in &members {
            if !lanes.iter().any(|&c| (c - r.across).abs() <= SAME) {
                lanes.push(r.across);
            }
        }
        let stuck = |across: f64| {
            (members.iter())
                .filter(|r| (r.across - across).abs() > SAME)
                .filter(|r| r.gate || shifted(lines, r, across, least[r.line], &ok).is_none())
                .count()
        };
        let Some(across) = (lanes.iter().copied()).min_by_key(|&c| stuck(c)) else {
            continue;
        };
        for r in members
            .iter()
            .filter(|r| !r.gate && (r.across - across).abs() > SAME)
        {
            if let Some(p) = shifted(lines, r, across, least[r.line], &ok) {
                lines[r.line] = p;
                moved = true;
            }
        }
    }
    moved
}

/// The line of run `r` with the run moved onto the line `across` off its axis, if it is still
/// there (an earlier move may have changed it), moves (see [`onto`]), turns no corner more than
/// 45° and `ok` takes it.
fn shifted(
    lines: &[Line],
    r: &Run,
    across: f64,
    least: (f64, f64),
    ok: &impl Fn(usize, &[[f32; 2]]) -> bool,
) -> Option<Line> {
    let p = &lines[r.line];
    let e = DIRS[r.axis];
    let still = r.k + 1 < p.len() && {
        let (d, _) = run(p[r.k], p[r.k + 1]);
        DIRS.iter()
            .position(|&m| m == d)
            .is_some_and(|i| i % 4 == r.axis)
            && (cross(e, f(p[r.k])) - r.across).abs() <= SAME
    };
    if !still {
        return None;
    }
    // A stretch of the target line beyond this run's.
    let (t, normal) = (r.lo - 1.0, [-e[1], e[0]]);
    let q0 = [t * e[0] + across * normal[0], t * e[1] + across * normal[1]];
    let q0 = [q0[0] as f32, q0[1] as f32];
    let moved = onto(p, r.k, (q0, e, r.hi - r.lo + 2.0), least)?;
    (!sharp(&moved) && ok(r.line, &moved)).then_some(moved)
}

#[cfg(test)]
#[path = "lanes_tests.rs"]
mod tests;
