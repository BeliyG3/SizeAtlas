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
/// ([`share`]), in rounds until no point is put in.
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
    // A point put into one bridge can make it run along a third: again until none is put in.
    for _ in 0..ROUNDS {
        let mut put = false;
        for x in 1..lines.len() {
            let (head, tail) = lines.split_at_mut(x);
            for y in head {
                let before = tail[0].len() + y.len();
                share(&mut tail[0], y);
                put |= tail[0].len() + y.len() != before;
            }
        }
        if !put {
            break;
        }
    }
}

/// A point of one line to put into a run of another: the run's index, how far along it, the
/// point there on the run's line, and the index of the point it stands for in its own line.
type Split = (usize, f64, [f32; 2], usize);

/// The points of `q` that lie inside a run of `p` along whose line a run of `q` at that point
/// runs (see [`Split`]); but not between two straights out of one gate (the frontend forks
/// those).
fn splits(p: &[[f32; 2]], q: &[[f32; 2]]) -> Vec<Split> {
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
                // Two straights out of one gate fork there.
                // The gate nodes a run sets out from: both ends of a bridge of one run.
                let nodes = |line: &[[f32; 2]], r: usize| {
                    let last = line.len() - 1;
                    [
                        (r == 0).then_some(line[0]),
                        (r + 2 == line.len()).then_some(line[last]),
                    ]
                };
                let shared_node = (nodes(p, k).into_iter().flatten())
                    .any(|a| nodes(q, r).into_iter().flatten().any(|b| a == b));
                let one_gate = gate(p, k) && gate(q, r) && shared_node;
                cross(d, e).abs() < 1e-9 && !one_gate
            };
            let before = m > 0 && on_line(m - 1);
            if before || (m + 1 < q.len() && on_line(m + 1)) {
                let on = [f(w[0])[0] + along * d[0], f(w[0])[1] + along * d[1]];
                out.push((k, along, [on[0] as f32, on[1] as f32], m));
            }
        }
    }
    out
}

/// `p` with `points` put in.
fn insert(p: &[[f32; 2]], mut points: Vec<Split>) -> Line {
    points.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
    let mut out = Vec::with_capacity(p.len() + points.len());
    let mut at = points.into_iter().peekable();
    for (k, &v) in p.iter().enumerate() {
        out.push(v);
        while let Some(&(_, _, s, _)) = at.peek().filter(|s| s.0 == k) {
            out.push(s);
            at.next();
        }
    }
    out
}

/// Gives `p` and `q` the same points where they run along one line: a point of one within
/// `SAME` of a point of the other becomes it (an end of a bridge, at its gate, stays); each point
/// of one where it runs along a run of the other goes into that run, set onto the run's line in
/// both (so the pieces keep their directions).
pub(crate) fn share(p: &mut Line, q: &mut Line) {
    meet(p, q);
    put(q, p);
    put(p, q);
}

/// The points of `from` where it runs along a run of `into` put into that run, and set onto its
/// line in `from` too (but its ends, at its gates).
fn put(from: &mut Line, into: &mut Line) {
    let found = splits(into, from);
    let last = from.len() - 1;
    for &(_, _, on, m) in &found {
        if m != 0 && m != last {
            from[m] = on;
        }
    }
    *into = insert(into, found);
}

/// Points of `p` and `q` within `SAME` of each other made one: an inner point takes an end's (a
/// gate's node), else `q`'s takes `p`'s.
fn meet(p: &mut [[f32; 2]], q: &mut [[f32; 2]]) {
    let near = |a: [f32; 2], b: [f32; 2]| a != b && (a[0] - b[0]).hypot(a[1] - b[1]) <= SAME as f32;
    let (lp, lq) = (p.len() - 1, q.len() - 1);
    for (i, a) in p.iter_mut().enumerate() {
        for (j, b) in q.iter_mut().enumerate() {
            if !near(*a, *b) {
                continue;
            }
            match (i == 0 || i == lp, j == 0 || j == lq) {
                (true, true) => {}
                (false, true) => *a = *b,
                _ => *b = *a,
            }
        }
    }
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
