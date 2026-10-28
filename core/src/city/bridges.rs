//! Roads over the canal: a crossing becomes a bridge, a road running along the water is cut off
//! at the embankment.

use super::CELL;
use super::grid::Grid;
use super::lattice::{Line, P, metres, step};
use super::road::Seg;
use std::collections::HashMap;

/// The longest bridge, metres.
const MAX_BRIDGE: f32 = 32.0;
/// Roads are probed for water every this many units along their line.
const PROBE: i64 = 16;
/// A stretch over water "lands" when the road this far beyond its end is dry, metres.
const LANDING: f32 = 0.75;

fn wet(water: &Grid<bool>, p: P) -> bool {
    let m = metres(p);
    let (x, y) = ((m[0] / CELL).floor(), (m[1] / CELL).floor());
    x >= 0.0
        && y >= 0.0
        && (x as usize) < water.w
        && (y as usize) < water.h
        && water.get(x as usize, y as usize)
}

/// `pieces` cut where they reach or leave the `water` (cells of `CELL` metres), with the stretches
/// over it either kept as bridges or dropped. Stretches over water that touch each other form a
/// crossing: one of at most `MAX_BRIDGE` metres in all is a bridge; in a longer one each straight
/// run is a bridge if it is that short and lands on dry ground at both ends, and the rest goes.
pub(crate) fn bridges(pieces: Vec<Seg>, water: &Grid<bool>) -> Vec<(Seg, bool)> {
    let mut dry = Vec::with_capacity(pieces.len());
    let mut over: Vec<Seg> = Vec::new();
    for s in pieces {
        for (piece, w) in runs(&s, water) {
            if w {
                over.push(piece);
            } else {
                dry.push((piece, false));
            }
        }
    }
    // Crossings: stretches over water joined at their ends.
    let mut root: Vec<usize> = (0..over.len()).collect();
    let mut at: HashMap<P, usize> = HashMap::new();
    for (i, s) in over.iter().enumerate() {
        for p in [s.a, s.b] {
            if let Some(&j) = at.get(&p) {
                union(&mut root, i, j);
            } else {
                at.insert(p, i);
            }
        }
    }
    let mut total: HashMap<usize, f32> = HashMap::new();
    for (i, s) in over.iter().enumerate() {
        *total.entry(find(&mut root, i)).or_default() += s.len();
    }
    // Straight runs inside a long crossing.
    let mut runs: HashMap<(usize, Line), Vec<usize>> = HashMap::new();
    for (i, s) in over.iter().enumerate() {
        let r = find(&mut root, i);
        if total[&r] > MAX_BRIDGE {
            runs.entry((r, s.line())).or_default().push(i);
        }
    }
    let mut keep: Vec<bool> = (0..over.len())
        .map(|i| total[&find(&mut root, i)] <= MAX_BRIDGE)
        .collect();
    for ((_, line), ids) in &runs {
        for run in straight(&over, ids) {
            let (lo, hi) = run.1;
            let len = (hi - lo) as f32 * line.scale();
            let beyond = (LANDING / line.scale()).ceil() as i64;
            let lands = !wet(water, line.at(lo - beyond)) && !wet(water, line.at(hi + beyond));
            if len <= MAX_BRIDGE && lands {
                for i in run.0 {
                    keep[i] = true;
                }
            }
        }
    }
    dry.extend(
        over.into_iter()
            .zip(keep)
            .filter(|(_, k)| *k)
            .map(|(s, _)| (s, true)),
    );
    dry
}

/// The contiguous stretches (piece indices and span) of the pieces `ids`, all on one line.
fn straight(over: &[Seg], ids: &[usize]) -> Vec<(Vec<usize>, (i64, i64))> {
    let mut by: Vec<(i64, i64, usize)> = ids
        .iter()
        .map(|&i| {
            let (lo, hi) = over[i].span();
            (lo, hi, i)
        })
        .collect();
    by.sort_unstable();
    let mut out: Vec<(Vec<usize>, (i64, i64))> = Vec::new();
    for (lo, hi, i) in by {
        match out.last_mut() {
            Some((members, span)) if lo <= span.1 => {
                members.push(i);
                span.1 = span.1.max(hi);
            }
            _ => out.push((vec![i], (lo, hi))),
        }
    }
    out
}

/// `s` cut where it reaches or leaves the water, each stretch with whether it lies over water.
fn runs(s: &Seg, water: &Grid<bool>) -> Vec<(Seg, bool)> {
    let Some((k, n)) = s.dir() else {
        return Vec::new();
    };
    let d = step(k);
    let at = |t: i64| [s.a[0] + d[0] * t, s.a[1] + d[1] * t];
    let mut out = Vec::new();
    let (mut from, mut state) = (0, wet(water, s.a));
    let mut t = 0;
    while t < n {
        let next = (t + PROBE).min(n);
        let w = wet(water, at(next));
        if w != state {
            // The change falls between `t` and `next`; it is put at `next`.
            if next > from {
                out.push((piece(s, at(from), at(next)), state));
            }
            (from, state) = (next, w);
        }
        t = next;
    }
    if n > from {
        out.push((piece(s, at(from), at(n)), state));
    }
    out
}

fn piece(s: &Seg, a: P, b: P) -> Seg {
    Seg {
        a: a.min(b),
        b: a.max(b),
        class: s.class,
    }
}

fn find(root: &mut [usize], mut i: usize) -> usize {
    while root[i] != i {
        root[i] = root[root[i]];
        i = root[i];
    }
    i
}

fn union(root: &mut [usize], a: usize, b: usize) {
    let (a, b) = (find(root, a), find(root, b));
    if a != b {
        root[a.max(b)] = a.min(b);
    }
}
