//! Roads over the canal: a crossing becomes a bridge, a road running along the water is cut off
//! at the embankment.

use super::CELL;
use super::grid::Grid;
use super::lattice::{Line, P, metres, step};
use super::path::point_segment;
use super::road::Seg;
use std::collections::BTreeMap;
use std::f32::consts::FRAC_1_SQRT_2;

/// The longest bridge, metres.
const MAX_BRIDGE: f32 = 100.0;
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

/// `pieces` cut where they reach or leave the `water` (cells of `CELL` metres) of the canal along
/// `axis` (metres), the stretches over it kept as bridges or dropped. Each straight run over the
/// water is a bridge when it crosses the canal: at most `MAX_BRIDGE` metres long, landing on dry
/// ground at both ends, and at 45° or more to the canal's axis where it runs. Every other stretch
/// over water goes, so a road along the canal ends at the embankment and none ends in the water.
pub(crate) fn bridges(pieces: Vec<Seg>, water: &Grid<bool>, axis: &[[f32; 2]]) -> Vec<(Seg, bool)> {
    let mut out = Vec::with_capacity(pieces.len());
    let mut over: Vec<Seg> = Vec::new();
    for s in pieces {
        for (piece, w) in runs(&s, water) {
            if w {
                over.push(piece);
            } else {
                out.push((piece, false));
            }
        }
    }
    let mut by_line: BTreeMap<Line, Vec<usize>> = BTreeMap::new();
    for (i, s) in over.iter().enumerate() {
        by_line.entry(s.line()).or_default().push(i);
    }
    let mut keep = vec![false; over.len()];
    for (line, ids) in &by_line {
        for (members, (lo, hi)) in straight(&over, ids) {
            let len = (hi - lo) as f32 * line.scale();
            let beyond = (LANDING / line.scale()).ceil() as i64;
            let lands = !wet(water, line.at(lo - beyond)) && !wet(water, line.at(hi + beyond));
            if len <= MAX_BRIDGE && lands && across(*line, (lo + hi) / 2, axis) {
                for i in members {
                    keep[i] = true;
                }
            }
        }
    }
    out.extend(
        over.into_iter()
            .zip(keep)
            .filter(|(_, k)| *k)
            .map(|(s, _)| (s, true)),
    );
    out
}

/// Whether `line` at position `t` runs at 45° or more to the segment of `axis` nearest to it.
fn across(line: Line, t: i64, axis: &[[f32; 2]]) -> bool {
    let p = metres(line.at(t));
    let Some(seg) = axis
        .windows(2)
        .min_by(|a, b| point_segment(p, a[0], a[1]).total_cmp(&point_segment(p, b[0], b[1])))
    else {
        return false;
    };
    let u = [seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]];
    let d = step(usize::from(line.f));
    let (d, u) = ([d[0] as f32, d[1] as f32], u.map(|v| v / u[0].hypot(u[1])));
    let cos = (d[0] * u[0] + d[1] * u[1]).abs() / d[0].hypot(d[1]);
    cos <= FRAC_1_SQRT_2 + 1e-3
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
