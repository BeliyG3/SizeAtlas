use super::*;
use crate::city::test_sets::{five, four, one};
use crate::city::{Gate, PolyKind, bridges};
use std::f32::consts::{PI, TAU};

pub(crate) fn refs(set: &[Island]) -> Vec<&Island> {
    set.iter().collect()
}

/// The island's outline polygons moved by `at`.
pub(crate) fn outline(island: &Island, at: [f32; 2]) -> Vec<Vec<[f32; 2]>> {
    (island.polys.iter())
        .filter(|p| p.kind == PolyKind::Island)
        .map(|p| p.points.iter().map(|q| add(*q, at)).collect())
        .collect()
}

/// The middle of the bounding box of the island's outline.
fn centre(island: &Island) -> [f32; 2] {
    let (mut lo, mut hi) = ([f32::INFINITY; 2], [f32::NEG_INFINITY; 2]);
    for p in outline(island, [0.0; 2]).iter().flatten() {
        lo = [lo[0].min(p[0]), lo[1].min(p[1])];
        hi = [hi[0].max(p[0]), hi[1].max(p[1])];
    }
    [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0]
}

pub(crate) fn add(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] + b[0], a[1] + b[1]]
}

pub(crate) fn sub(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] - b[0], a[1] - b[1]]
}

pub(crate) fn len(a: [f32; 2]) -> f32 {
    a[0].hypot(a[1])
}

fn cross(o: [f32; 2], p: [f32; 2], q: [f32; 2]) -> f32 {
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
}

pub(crate) fn point_segment(p: [f32; 2], a: [f32; 2], b: [f32; 2]) -> f32 {
    let (ab, ap) = (sub(b, a), sub(p, a));
    let t = ((ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1]).max(1e-12))
        .clamp(0.0, 1.0);
    len([ap[0] - t * ab[0], ap[1] - t * ab[1]])
}

/// Whether the segments `a`-`b` and `c`-`d` cross at a point inside both.
pub(crate) fn crossing(a: [f32; 2], b: [f32; 2], c: [f32; 2], d: [f32; 2]) -> bool {
    cross(a, b, c) * cross(a, b, d) < 0.0 && cross(c, d, a) * cross(c, d, b) < 0.0
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

pub(crate) fn sides(poly: &[[f32; 2]]) -> impl Iterator<Item = ([f32; 2], [f32; 2])> + '_ {
    (0..poly.len()).map(|i| (poly[i], poly[(i + 1) % poly.len()]))
}

/// The least distance between two sets of polygons, 0 where they overlap.
fn gap(a: &[Vec<[f32; 2]>], b: &[Vec<[f32; 2]>]) -> f32 {
    let mut best = f32::INFINITY;
    for (p, q) in a.iter().flat_map(|p| b.iter().map(move |q| (p, q))) {
        if inside(p[0], q) || inside(q[0], p) {
            return 0.0;
        }
        for (s, t) in sides(p).flat_map(|s| sides(q).map(move |t| (s, t))) {
            if crossing(s.0, s.1, t.0, t.1) {
                return 0.0;
            }
            let d = [
                point_segment(s.0, t.0, t.1),
                point_segment(s.1, t.0, t.1),
                point_segment(t.0, s.0, s.1),
                point_segment(t.1, s.0, s.1),
            ];
            best = d.into_iter().fold(best, f32::min);
        }
    }
    best
}

pub(crate) fn gate(island: &Island, node: u32) -> &Gate {
    island.gates.iter().find(|g| g.node == node).unwrap()
}

/// Points every 6 m or less along the bridge, its corners included.
pub(crate) fn probes(points: &[[f32; 2]]) -> Vec<[f32; 2]> {
    let mut out = vec![points[0]];
    for w in points.windows(2) {
        let n = (len(sub(w[1], w[0])) / 6.0).ceil().max(1.0) as usize;
        for k in 1..=n {
            let t = k as f32 / n as f32;
            out.push([
                w[0][0] + t * (w[1][0] - w[0][0]),
                w[0][1] + t * (w[1][1] - w[0][1]),
            ]);
        }
    }
    out
}

#[test]
fn one_island_stays_put() {
    let set = one();
    let at = place(&refs(set));
    let c = centre(&set[0]);
    assert_eq!(at.len(), 1);
    assert!(len(add(at[0], c)) < 1e-3, "{at:?} vs {c:?}");
    assert!(bridges(&refs(set), &at).is_empty());
}

#[test]
fn straits_are_110_m() {
    let set = four();
    let at = place(&refs(set));
    let shapes: Vec<_> = set.iter().zip(&at).map(|(s, &a)| outline(s, a)).collect();
    for i in 1..set.len() {
        let gaps: Vec<f32> = (0..i).map(|j| gap(&shapes[i], &shapes[j])).collect();
        eprintln!("island {i}: {gaps:?}");
        assert!(gaps.iter().all(|&g| g >= STRAIT - 0.01), "{i}: {gaps:?}");
        assert!(gaps.iter().any(|&g| g <= STRAIT + 12.0), "{i}: {gaps:?}");
    }
}

#[test]
fn island_i_on_its_ray() {
    let set = four();
    let at = place(&refs(set));
    let from = add(centre(&set[0]), at[0]);
    for i in 1..set.len() {
        let d = sub(add(centre(&set[i]), at[i]), from);
        let off = (d[1].atan2(d[0]) - i as f32 * SPIRAL + PI).rem_euclid(TAU) - PI;
        assert!(off.abs() <= 0.5f32.to_radians(), "{i}: {off}");
    }
}

#[test]
fn deterministic() {
    let set = five();
    assert_eq!(place(&refs(set)), place(&refs(set)));
}

#[test]
fn bearings_join_the_box_middles() {
    let set = four();
    let at = place(&refs(set));
    let aims = bearings(&refs(set), &at);
    let mid = |i: usize| add(centre(&set[i]), at[i]);
    for (i, row) in aims.iter().enumerate() {
        let others = (0..set.len()).filter(|&j| j != i);
        for (j, &a) in others.zip(row) {
            let d = sub(mid(j), mid(i));
            assert!((d[1].atan2(d[0]) - a).abs() < 1e-4, "{i} -> {j}");
        }
    }
}

#[test]
fn settled_within_two_degrees_across_the_seam() {
    let deg = |d: f32| d.to_radians();
    let used = [vec![PI - deg(0.5)], vec![deg(10.0)]];
    assert!(settled(&used, &[vec![-PI + deg(1.0)], vec![deg(11.9)]]));
    assert!(!settled(&used, &[vec![-PI + deg(1.0)], vec![deg(12.1)]]));
}
