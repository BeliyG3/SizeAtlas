//! Cutting roads where they cross or meet, and carrying loose road ends on to the next road.

use super::lattice::{P, UNIT, step};
use super::road::{RoadClass, Seg};
use std::collections::HashMap;

/// Side of a bucket of the segment index, units (64 m).
const BUCKET: i64 = 64 * UNIT as i64;
/// How far a loose end is carried on to meet a road, metres: a lane to its street, anything
/// else past a road that a merge took away.
const LANE_REACH: f32 = 6.0;
const REACH: f32 = 20.0;

/// The segments of `segs` by the buckets their bounding boxes touch.
struct Index {
    buckets: HashMap<(i64, i64), Vec<usize>>,
}

impl Index {
    fn new(segs: &[Seg]) -> Self {
        let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (i, s) in segs.iter().enumerate() {
            for key in keys(s.a, s.b) {
                buckets.entry(key).or_default().push(i);
            }
        }
        Self { buckets }
    }

    /// Segments whose buckets the box of `a`-`b` touches, each once, in order.
    fn near(&self, a: P, b: P) -> Vec<usize> {
        let mut out: Vec<usize> = keys(a, b)
            .filter_map(|k| self.buckets.get(&k))
            .flatten()
            .copied()
            .collect();
        out.sort_unstable();
        out.dedup();
        out
    }
}

fn keys(a: P, b: P) -> impl Iterator<Item = (i64, i64)> {
    let lo = [a[0].min(b[0]), a[1].min(b[1])].map(|v| v.div_euclid(BUCKET));
    let hi = [a[0].max(b[0]), a[1].max(b[1])].map(|v| v.div_euclid(BUCKET));
    (lo[1]..=hi[1]).flat_map(move |y| (lo[0]..=hi[0]).map(move |x| (x, y)))
}

/// Where `s` and `u` meet, as positions along `s`: a crossing, or the ends of a shared stretch.
fn meets(s: &Seg, u: &Seg) -> Vec<i64> {
    let (ls, lu) = (s.line(), u.line());
    let (slo, shi) = s.span();
    let (ulo, uhi) = u.span();
    if ls == lu {
        return [u.a, u.b]
            .into_iter()
            .map(|p| ls.t(p))
            .filter(|t| (slo..=shi).contains(t))
            .collect();
    }
    match ls.cross(lu) {
        Some(x)
            if (slo..=shi).contains(&ls.t(x))
                && (ulo..=uhi).contains(&lu.t(x))
                && ls.at(ls.t(x)) == x
                && lu.at(lu.t(x)) == x =>
        {
            vec![ls.t(x)]
        }
        _ => Vec::new(),
    }
}

/// `segs` cut at every crossing and junction, without repeats: of two equal pieces the higher
/// class stays.
pub(crate) fn split(segs: &[Seg]) -> Vec<Seg> {
    let index = Index::new(segs);
    let mut cuts: Vec<Vec<i64>> = segs
        .iter()
        .map(|s| {
            let (lo, hi) = s.span();
            vec![lo, hi]
        })
        .collect();
    for ids in index.buckets.values() {
        for (n, &i) in ids.iter().enumerate() {
            for &j in &ids[n + 1..] {
                cuts[i].extend(meets(&segs[i], &segs[j]));
                cuts[j].extend(meets(&segs[j], &segs[i]));
            }
        }
    }
    let mut best: HashMap<(P, P), usize> = HashMap::new();
    let mut out: Vec<Seg> = Vec::new();
    for (s, mut ts) in segs.iter().zip(cuts) {
        ts.sort_unstable();
        ts.dedup();
        let line = s.line();
        for w in ts.windows(2) {
            let (a, b) = (line.at(w[0]), line.at(w[1]));
            let (a, b) = (a.min(b), a.max(b));
            let piece = Seg {
                a,
                b,
                class: s.class,
            };
            match best.get(&(a, b)) {
                Some(&k) => out[k].class = out[k].class.min(s.class),
                None => {
                    best.insert((a, b), out.len());
                    out.push(piece);
                }
            }
        }
    }
    out
}

/// Number of pieces at each end point.
pub(crate) fn degrees(pieces: &[Seg]) -> HashMap<P, usize> {
    let mut deg = HashMap::new();
    for s in pieces {
        *deg.entry(s.a).or_default() += 1;
        *deg.entry(s.b).or_default() += 1;
    }
    deg
}

/// For every loose end of `pieces` (cut and without repeats), the piece that carries it on along
/// its own line to the nearest road within reach, if there is one.
pub(crate) fn extensions(pieces: &[Seg]) -> Vec<Seg> {
    let index = Index::new(pieces);
    let deg = degrees(pieces);
    let mut out = Vec::new();
    for s in pieces {
        for (end, from) in [(s.b, s.a), (s.a, s.b)] {
            if deg[&end] != 1 {
                continue;
            }
            let Some((k, _)) = super::lattice::dir(from, end) else {
                continue;
            };
            if let Some(hit) = cast(pieces, &index, end, k, reach(s.class)) {
                out.push(Seg {
                    a: end,
                    b: hit,
                    class: s.class,
                });
            }
        }
    }
    out
}

fn reach(c: RoadClass) -> f32 {
    if c == RoadClass::Lane {
        LANE_REACH
    } else {
        REACH
    }
}

/// The first point of another piece on the ray from `p` along direction `k`, within `metres`.
fn cast(pieces: &[Seg], index: &Index, p: P, k: usize, metres: f32) -> Option<P> {
    let d = step(k);
    let scale = if k % 2 == 1 {
        std::f32::consts::SQRT_2
    } else {
        1.0
    };
    let n = (metres * UNIT / scale) as i64;
    let ray = Seg {
        a: p,
        b: [p[0] + d[0] * n, p[1] + d[1] * n],
        class: RoadClass::Lane,
    };
    let line = ray.line();
    let start = line.t(p);
    let ahead = |t: i64| (t - start) * (line.t(ray.b) - start).signum();
    index
        .near(ray.a, ray.b)
        .into_iter()
        .map(|i| &pieces[i])
        .filter(|u| u.a != p && u.b != p)
        .flat_map(|u| meets(&ray, u))
        .filter(|&t| ahead(t) > 0)
        .min_by_key(|&t| ahead(t))
        .map(|t| line.at(t))
}
