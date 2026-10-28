//! Roads that run side by side become one: where a lesser road runs parallel to a greater one
//! closer than half their widths together, its stretch is dropped, and where it goes on, a short
//! connector at 0 or 90 degrees joins it to the greater road.

use super::lattice::{Line, UNIT};
use super::road::{RoadClass, Seg, road_width};
use std::collections::BTreeMap;

/// The widest road, metres: it bounds the search for parallel neighbours.
const WIDEST: f32 = 16.0;

/// `segs` with every parallel overlap resolved, the higher class (then the longer piece) kept.
/// Points and skew pieces are dropped. The connectors keep the class of the road they join.
pub(crate) fn absorb(mut segs: Vec<Seg>) -> Vec<Seg> {
    segs.retain(|s| s.dir().is_some());
    segs.sort_by(|x, y| {
        (x.class.cmp(&y.class))
            .then(y.len().total_cmp(&x.len()))
            .then(x.a.cmp(&y.a))
            .then(x.b.cmp(&y.b))
    });
    // Kept pieces by their line.
    let mut kept: Vec<Seg> = Vec::with_capacity(segs.len());
    let mut by_line: BTreeMap<Line, Vec<usize>> = BTreeMap::new();
    let mut links = Vec::new();
    for s in segs {
        let line = s.line();
        let (lo, hi) = s.span();
        let mut covers = covers(&s, &kept, &by_line);
        if covers.is_empty() {
            by_line.entry(line).or_default().push(kept.len());
            kept.push(s);
            continue;
        }
        covers.sort_by_key(|c| (c.0, c.1));
        for (from, to, before, after) in gaps(lo, hi, &covers) {
            for (t, other) in [(from, before), (to, after)] {
                if let Some(other) = other {
                    let (p, q) = (line.at(t), other.at(t));
                    if p != q {
                        links.push(Seg {
                            a: p,
                            b: q,
                            class: s.class,
                        });
                    }
                }
            }
            by_line.entry(line).or_default().push(kept.len());
            kept.push(Seg {
                a: line.at(from),
                b: line.at(to),
                class: s.class,
            });
        }
    }
    kept.extend(links);
    kept
}

/// The spans along `s` that kept pieces parallel to it and close enough cover, with their lines.
fn covers(s: &Seg, kept: &[Seg], by_line: &BTreeMap<Line, Vec<usize>>) -> Vec<(i64, i64, Line)> {
    let line = s.line();
    let (lo, hi) = s.span();
    let reach = 0.5 * (road_width(s.class) + WIDEST);
    let reach = (reach * UNIT * std::f32::consts::SQRT_2).ceil() as i64;
    let from = Line {
        f: line.f,
        c: line.c - reach,
    };
    let to = Line {
        f: line.f,
        c: line.c + reach,
    };
    let mut out = Vec::new();
    for (&other, ids) in by_line.range(from..=to) {
        for &i in ids {
            let k = &kept[i];
            if line.apart(other) >= half_sum(s.class, k.class) {
                continue;
            }
            let (a, b) = k.span();
            let (a, b) = (a.max(lo), b.min(hi));
            if a < b {
                out.push((a, b, other));
            }
        }
    }
    out
}

fn half_sum(a: RoadClass, b: RoadClass) -> f32 {
    0.5 * (road_width(a) + road_width(b))
}

/// The uncovered spans of `[lo, hi]` given `covers` sorted by start: each with the line of the
/// cover it starts from and the one it runs into (`None` at the ends of `[lo, hi]`).
fn gaps(
    lo: i64,
    hi: i64,
    covers: &[(i64, i64, Line)],
) -> Vec<(i64, i64, Option<Line>, Option<Line>)> {
    let mut out = Vec::new();
    let (mut at, mut from) = (lo, None);
    let mut j = 0;
    while j < covers.len() {
        let (a, b, l) = covers[j];
        if a > at {
            out.push((at, a, from, Some(l)));
        }
        let (mut end, mut end_line) = (b, l);
        j += 1;
        while j < covers.len() && covers[j].0 <= end {
            if covers[j].1 > end {
                (end, end_line) = (covers[j].1, covers[j].2);
            }
            j += 1;
        }
        if end > at {
            (at, from) = (end, Some(end_line));
        }
    }
    if at < hi {
        out.push((at, hi, from, None));
    }
    out
}
