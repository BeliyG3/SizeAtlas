use super::*;
use crate::city::map::{Poly, Stats};
use crate::city::test_sets::{five, four, four_real, one, three};
use crate::city::{Gate, PolyKind, bridges, place_on_rays};
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
fn alignment_keeps_straits() {
    for set in [three(), four(), five(), four_real()] {
        let at = place(&refs(set));
        let shapes: Vec<_> = set.iter().zip(&at).map(|(s, &a)| outline(s, a)).collect();
        for i in 1..set.len() {
            let gaps: Vec<f32> = (0..i).map(|j| gap(&shapes[i], &shapes[j])).collect();
            assert!(gaps.iter().all(|&g| g >= STRAIT - 0.01), "{i}: {gaps:?}");
            assert!(gaps.iter().any(|&g| g <= STRAIT + 12.0), "{i}: {gaps:?}");
        }
    }
}

/// The placed island `j < i` that island `i` stands gate against gate with: their gates towards
/// each other face opposite ways and `i`'s lies on the line out of `j`'s (within 5 cm).
fn against(set: &[Island], at: &[[f32; 2]], i: usize) -> Option<usize> {
    let node = |k: usize, g: &Gate| add(set[k].nodes[g.node as usize], at[k]);
    (0..i).find(|&j| {
        let (Some(gi), Some(gj)) = (set[i].facing(j), set[j].facing(i - 1)) else {
            return false;
        };
        let d = sub(node(i, gi), node(j, gj));
        let across = d[0] * gj.dir[1] - d[1] * gj.dir[0];
        let ahead = d[0] * gj.dir[0] + d[1] * gj.dir[1];
        let facing = gi.dir[0] * gj.dir[0] + gi.dir[1] * gj.dir[1] < -0.999;
        facing && across.abs() <= 0.05 && ahead > 0.0
    })
}

/// How far (radians) island `i` at `at` stands off its ray `i · SPIRAL` from the first.
fn off_ray(set: &[Island], at: &[[f32; 2]], i: usize) -> f32 {
    let d = sub(add(centre(&set[i]), at[i]), add(centre(&set[0]), at[0]));
    ((d[1].atan2(d[0]) - i as f32 * SPIRAL + PI).rem_euclid(TAU) - PI).abs()
}

/// Island `i` stands on the ray `i · SPIRAL`, unless it stands gate against gate; on the rays
/// alone, all of them do.
#[test]
fn island_i_on_its_ray() {
    let set = four();
    let (at, rays) = (place(&refs(set)), place_on_rays(&refs(set)));
    let near = 0.5f32.to_radians();
    for i in 1..set.len() {
        let off = off_ray(set, &at, i);
        assert!(off <= near || against(set, &at, i).is_some(), "{i}: {off}");
        assert!(off_ray(set, &rays, i) <= near, "{i}");
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

/// A 200 m square island at the origin with one gate at `node` facing `dir` towards
/// neighbour 0.
fn square(node: [f32; 2], dir: [f32; 2]) -> Island {
    let points = vec![[0.0, 0.0], [0.0, 200.0], [200.0, 200.0], [200.0, 0.0]];
    let poly = Poly {
        kind: PolyKind::Island,
        id: 0,
        parent: 0,
        size: 0,
        points,
    };
    let stats = Stats {
        built: 0.0,
        inner_empty: 0.0,
        shore: 0.0,
        water: 0.0,
    };
    Island {
        width: 200.0,
        height: 200.0,
        polys: vec![poly],
        nodes: vec![node],
        edges: Vec::new(),
        gates: vec![Gate {
            node: 0,
            dir,
            neighbours: vec![0],
        }],
        stats,
    }
}

/// Gates facing each other: the second island stands across the strait from the first, its
/// gate on the line of the first's, and their bridge is one straight run.
#[test]
fn aligned_pair_stands_gate_against_gate() {
    let first = square([200.0, 50.0], [1.0, 0.0]);
    let second = square([0.0, 150.0], [-1.0, 0.0]);
    let at = place(&[&first, &second]);
    assert!(
        len(sub(at[1], add(at[0], [310.0, -100.0]))) < 0.05,
        "{at:?}"
    );
    let all = bridges(&[&first, &second], &at);
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].points.len(), 2, "{:?}", all[0]);
}

/// Gates that do not face each other leave the island on its ray.
#[test]
fn falls_back_to_the_ray() {
    let first = square([200.0, 50.0], [1.0, 0.0]);
    let second = square([0.0, 150.0], [0.0, -1.0]);
    let mut bare = second.clone();
    bare.gates.clear();
    assert_eq!(place(&[&first, &second]), place(&[&first, &bare]));
}

/// Of four islands, those placed gate against gate with a neighbour get a one-run bridge along
/// the neighbour's gate.
#[test]
fn aligned_neighbours_get_straight_bridges() {
    let set = four();
    let at = place(&refs(set));
    let all = bridges(&refs(set), &at);
    let mut aligned = 0;
    for i in 1..set.len() {
        let Some(j) = against(set, &at, i) else {
            continue;
        };
        aligned += 1;
        let gj = set[j].facing(i - 1).unwrap();
        let b = all
            .iter()
            .find(|b| (b.a.0, b.b.0) == (j, i))
            .expect("a bridge");
        assert_eq!(b.points.len(), 2, "{b:?}");
        let run = sub(b.points[1], b.points[0]);
        let off = (run[1].atan2(run[0]) - gj.dir[1].atan2(gj.dir[0]) + PI).rem_euclid(TAU) - PI;
        assert!(off.abs() <= 1e-3, "{off}: {b:?}");
    }
    assert!(
        aligned > 0,
        "no island stands gate against gate: the test proves nothing"
    );
}
