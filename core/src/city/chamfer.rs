//! Cutting the sharp corners of an overpass: a turn of 90° becomes two of 45°, one of 135°
//! three, so highways, the ring and ramps turn by 45° at most.

use super::lattice::{nearest_dir, step};
use super::path::{apart, simplify};

/// Length of the cut across a right angle, metres.
pub(crate) const TARGET: f32 = 30.0;
/// The legs keep this much on either side of a cut, metres, where they are long enough.
pub(crate) const MIN: f32 = 4.0;
/// A turn of 135° takes two passes; the third catches what the second made.
const PASSES: usize = 3;

/// `line` (octilinear, metres; closed when its ends meet) with every turn of 90° or 135° cut on
/// its inner side: the vertex gives way to two points on its legs, `TARGET / √2` back along
/// each (less where a leg must keep `MIN` between its two ends' cuts, or half of a leg shorter
/// than `2 · MIN`). A 90° turn becomes two of 45°, a 135° one three; a vertex where the line
/// turns back is dropped first. The ends stay, and a cut depends on its two legs alone, so
/// lines that share a stretch share its cuts.
pub(crate) fn chamfer(line: &[[f32; 2]]) -> Vec<[f32; 2]> {
    let closed = line.len() > 3 && line[0] == line[line.len() - 1];
    let mut pts = if closed {
        line[..line.len() - 1].to_vec()
    } else {
        line.to_vec()
    };
    while let Some(i) = doubling_back(&pts, closed) {
        pts.remove(i);
    }
    for _ in 0..PASSES {
        match cut(&pts, closed) {
            Some(next) => pts = next,
            None => break,
        }
    }
    if closed {
        pts.push(pts[0]);
    }
    pts
}

/// The unit step of direction `k` (a diagonal one is `√2` long).
fn unit(k: usize) -> [f32; 2] {
    step(k).map(|v| v as f32)
}

/// The first vertex where `pts` turns back the way it came: the line goes on from the one
/// before.
fn doubling_back(pts: &[[f32; 2]], closed: bool) -> Option<usize> {
    let n = pts.len();
    let k = |i: usize| {
        let (a, b) = (pts[i % n], pts[(i + 1) % n]);
        nearest_dir([b[0] - a[0], b[1] - a[1]])
    };
    let inner = if closed { 0..n } else { 1..n.saturating_sub(1) };
    (n > 2).then(|| {
        inner
            .into_iter()
            .find(|&i| (k(i) + 8 - k(i + n - 1)) % 8 == 4)
    })?
}

/// One pass of [`chamfer`] over the vertices of `pts`; `None` when no turn is sharp.
fn cut(pts: &[[f32; 2]], closed: bool) -> Option<Vec<[f32; 2]>> {
    let n = pts.len();
    if n < 3 {
        return None;
    }
    // Leg `i` runs from vertex `i` to the next one: its direction and length.
    let legs: Vec<(usize, f32)> = (0..n)
        .map(|i| {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            (nearest_dir([b[0] - a[0], b[1] - a[1]]), apart(a, b))
        })
        .collect();
    // Unit steps a cut may take back along leg `l`.
    let room = |l: usize| {
        let (k, len) = legs[l];
        let m = if len >= 2.0 * MIN {
            0.5 * (len - MIN)
        } else {
            0.5 * len
        };
        m / unit(k)[0].hypot(unit(k)[1])
    };
    let mut sharp = false;
    let mut out = Vec::with_capacity(n + 4);
    for (i, &p) in pts.iter().enumerate() {
        let prev = (i + n - 1) % n;
        let (k_in, k_out) = (legs[prev].0, legs[i].0);
        let t = (k_out + 8 - k_in) % 8;
        if !(closed || (i > 0 && i + 1 < n)) || !matches!(t.min(8 - t), 2 | 3) {
            out.push(p);
            continue;
        }
        sharp = true;
        let (back, on) = (unit(k_in), unit(k_out));
        let want = std::f32::consts::FRAC_1_SQRT_2 * TARGET / back[0].hypot(back[1]);
        let s = want.min(room(prev)).min(room(i));
        out.push([p[0] - s * back[0], p[1] - s * back[1]]);
        out.push([p[0] + s * on[0], p[1] + s * on[1]]);
    }
    sharp.then(|| simplify(out))
}

#[cfg(test)]
#[path = "chamfer_tests.rs"]
mod tests;
