//! Bridges that run together: their runs side by side are moved onto one line (see
//! [`align`]) and the stretch they share gets the same points in each, so they draw as one
//! trunk road with forks.

use super::lanes::{Line, SAME, align, cross, dot, f, run, sub};
use super::path::point_segment;

pub(crate) use super::lanes::NEAR;

/// Rounds of moving runs onto one line: a move can bring a run beside another.
const ROUNDS: usize = 8;

/// The bridges `lines` made one trunk where they run together: rounds of [`align`] (the
/// straights out of bridge `k`'s gates keep `least[k]`, `ok(k, line)` judges its new line) until
/// none moves, then every two given the same points where they run along one line
/// ([`share`]).
pub(crate) fn join(
    lines: &mut [Line],
    least: &[(f64, f64)],
    ok: impl Fn(usize, &[[f32; 2]]) -> bool,
) {
    for _ in 0..ROUNDS {
        if !align(lines, least, &ok) {
            break;
        }
    }
    for x in 1..lines.len() {
        let (head, tail) = lines.split_at_mut(x);
        for y in head {
            share(&mut tail[0], y);
        }
    }
}

/// The points of `q` that lie inside a run of `p` along whose line a run of `q` at that point
/// runs, with the index of `p`'s run and how far along it; but not between two runs out of
/// gates (the frontend forks those).
fn splits(p: &[[f32; 2]], q: &[[f32; 2]]) -> Vec<(usize, f64, [f32; 2])> {
    let mut out = Vec::new();
    let gate = |line: &[[f32; 2]], r: usize| r == 0 || r + 2 == line.len();
    for (k, w) in p.windows(2).enumerate() {
        let (d, l) = run(w[0], w[1]);
        for (m, &v) in q.iter().enumerate() {
            let rel = sub(f(v), f(w[0]));
            let (aside, along) = (cross(d, rel), dot(d, rel));
            if aside.abs() > SAME || along <= SAME || along >= l - SAME {
                continue;
            }
            // A point where `q` only crosses `p`'s line is no fork.
            let on_line = |o: usize| {
                let r = m.min(o);
                let (e, _) = run(q[r], q[r + 1]);
                cross(d, e).abs() < 1e-9 && !(gate(p, k) && gate(q, r))
            };
            let before = m > 0 && on_line(m - 1);
            if before || (m + 1 < q.len() && on_line(m + 1)) {
                out.push((k, along, v));
            }
        }
    }
    out
}

/// `p` with `points` (run index, how far along it, point) put in.
fn insert(p: &[[f32; 2]], mut points: Vec<(usize, f64, [f32; 2])>) -> Line {
    points.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
    let mut out = Vec::with_capacity(p.len() + points.len());
    let mut at = points.into_iter().peekable();
    for (k, &v) in p.iter().enumerate() {
        out.push(v);
        while let Some(&(_, _, s)) = at.peek().filter(|s| s.0 == k) {
            out.push(s);
            at.next();
        }
    }
    out
}

/// Gives `p` and `q` the same points where they run along one line: each point of one where it
/// runs along a run of the other goes into that run.
pub(crate) fn share(p: &mut Line, q: &mut Line) {
    let into_p = splits(p, q);
    *p = insert(p, into_p);
    let into_q = splits(q, p);
    *q = insert(q, into_q);
}

/// Whether runs `s` and `t` are one stretch of a trunk: the same two ends, either way round.
pub(crate) fn one_run(s: &[[f32; 2]], t: &[[f32; 2]]) -> bool {
    let same = |a: [f32; 2], b: [f32; 2]| (a[0] - b[0]).hypot(a[1] - b[1]) <= SAME as f32;
    (same(s[0], t[0]) && same(s[1], t[1])) || (same(s[0], t[1]) && same(s[1], t[0]))
}

/// Whether runs `s` and `t` meet where one ends: a fork or a join, not a crossing.
pub(crate) fn touch(s: &[[f32; 2]], t: &[[f32; 2]]) -> bool {
    let on = |p: [f32; 2], r: &[[f32; 2]]| point_segment(p, r[0], r[1]) <= SAME as f32;
    s.iter().any(|&a| on(a, t)) || t.iter().any(|&b| on(b, s))
}

#[cfg(test)]
#[path = "trunk_tests.rs"]
mod tests;
