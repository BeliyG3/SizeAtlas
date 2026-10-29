//! An island's coast in world metres, and how far a bridge keeps from the coasts.

use super::chart::{bounds, samples};
use super::path::point_segment;

/// A bridge keeps this far from every outline but on its way out of its gates, metres.
pub(crate) const CLEAR: f32 = 20.0;

/// An outline polygon and its bounding box.
type Boxed = (Vec<[f32; 2]>, [f32; 2], [f32; 2]);

/// An island's outline polygons with their bounding boxes.
pub(crate) struct Coast {
    polys: Vec<Boxed>,
}

impl Coast {
    pub fn new(shape: &[Vec<[f32; 2]>]) -> Self {
        let polys = (shape.iter())
            .map(|p| {
                let (lo, hi) = bounds(p);
                (p.clone(), lo, hi)
            })
            .collect();
        Self { polys }
    }

    /// The distance from `p` to the nearest side, or `reach` where none is nearer.
    pub fn distance(&self, p: [f32; 2], reach: f32) -> f32 {
        let mut best = reach;
        for (poly, lo, hi) in &self.polys {
            let off = (lo[0] - p[0]).max(p[0] - hi[0]).max(0.0);
            if off.hypot((lo[1] - p[1]).max(p[1] - hi[1]).max(0.0)) >= best {
                continue;
            }
            for i in 0..poly.len() {
                best = best.min(point_segment(p, poly[i], poly[(i + 1) % poly.len()]));
            }
        }
        best
    }

    /// Whether an outline holds `p`.
    pub fn holds(&self, p: [f32; 2]) -> bool {
        let boxed = |lo: &[f32; 2], hi: &[f32; 2]| {
            p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1]
        };
        (self.polys.iter()).any(|(poly, lo, hi)| boxed(lo, hi) && inside(p, poly))
    }

    /// Whether `p` lies over the island or within `r` of its outline.
    pub fn near(&self, p: [f32; 2], r: f32) -> bool {
        self.holds(p) || self.distance(p, r) < r
    }
}

pub(crate) fn inside(p: [f32; 2], poly: &[[f32; 2]]) -> bool {
    let mut odd = false;
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0])
        {
            odd = !odd;
        }
    }
    odd
}

/// Whether every point of the bridge `points` (every `WORLD_CELL`) keeps `CLEAR` from every
/// coast, but on its way out of a gate: on its first run from its start until it first keeps
/// clear of the island `from`, and on its last run likewise back from its end and `to`.
pub(crate) fn keeps_clear(
    coasts: &[Coast],
    points: &[[f32; 2]],
    from: Option<usize>,
    to: Option<usize>,
) -> bool {
    let last = points.len().saturating_sub(2);
    let close = |k: Option<usize>, p: &[f32; 2]| k.is_some_and(|k| coasts[k].near(*p, CLEAR));
    let mut leaving = from;
    for (r, run) in points.windows(2).enumerate() {
        let pts = samples(run, false);
        let tail = match r == last {
            true => pts.len() - pts.iter().rev().take_while(|p| close(to, p)).count(),
            false => pts.len(),
        };
        for (q, p) in pts.iter().enumerate() {
            leaving = leaving.filter(|_| r == 0 && close(leaving, p));
            let arriving = to.filter(|_| q >= tail);
            let blocked = (coasts.iter().enumerate())
                .any(|(k, c)| Some(k) != leaving && Some(k) != arriving && c.near(*p, CLEAR));
            if blocked {
                return false;
            }
        }
    }
    true
}
