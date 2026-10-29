//! Roads that run side by side become one: where a lesser road runs parallel to a greater one
//! closer than half their widths together, its stretch is dropped, and where it goes on, a short
//! connector joins it to the greater road: at 0 or 90 degrees, at 45° for an overpass so it
//! does not turn sharper than that.

use super::lattice::{Line, UNIT, dir};
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
            for (t, other, into) in [(from, before, -1), (to, after, 1)] {
                if let Some(other) = other {
                    let p = line.at(t);
                    let q = (s.class.overpass())
                        .then(|| slant(line, other, t, into, &kept, &by_line))
                        .flatten()
                        .unwrap_or(other.at(t));
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
            // An overpass keeps its stretch where the cover is too short for 45° connectors.
            let sides = i64::from(a > lo) + i64::from(b < hi);
            let room = if s.class.overpass() {
                sides * (other.c - line.c).abs()
            } else {
                0
            };
            if a + room < b {
                out.push((a, b, other));
            }
        }
    }
    out
}

/// Where an overpass on `line`, cut at position `t` with the greater road on `other` running
/// on towards `into` (-1: lower positions, 1: higher), joins `other` at 45° ahead of the cut:
/// the point of a kept piece of `other` the connector reaches.
fn slant(
    line: Line,
    other: Line,
    t: i64,
    into: i64,
    kept: &[Seg],
    by_line: &BTreeMap<Line, Vec<usize>>,
) -> Option<[i64; 2]> {
    let p = line.at(t);
    // Along `line` towards higher positions runs direction `f`; the way on is `f` or `f + 4`.
    let ahead = if into > 0 {
        line.f as usize
    } else {
        line.f as usize + 4
    };
    let off = other.c - line.c;
    let pieces = by_line.get(&other)?;
    [t, t + off, t - off].into_iter().find_map(|u| {
        let q = other.at(u);
        let (k, _) = dir(p, q)?;
        let slanted = matches!((k + 8 - ahead) % 8, 1 | 7);
        let on = pieces.iter().any(|&i| {
            let (lo, hi) = kept[i].span();
            (lo..=hi).contains(&u)
        });
        (slanted && on).then_some(q)
    })
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
