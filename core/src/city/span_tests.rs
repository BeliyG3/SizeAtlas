use super::*;
use crate::city::archipelago::tests::{
    add, crossing, five, four, gate, inside, len, outline, point_segment, probes, refs, sides, sub,
    three,
};
use crate::city::{Island, place};
use std::f32::consts::FRAC_PI_4;
use std::time::Instant;

/// No bridge comes nearer than this to an island's outline, but on its way out of its gates.
const CLEARANCE: f32 = 20.0;

type Shapes = Vec<Vec<Vec<[f32; 2]>>>;

/// The islands' places, their outlines there and their bridges.
fn laid(set: &[Island]) -> (Vec<[f32; 2]>, Shapes, Vec<Bridge>) {
    let at = place(&refs(set));
    let shapes = set.iter().zip(&at).map(|(s, &a)| outline(s, a)).collect();
    let all = bridges(&refs(set), &at);
    (at, shapes, all)
}

fn octilinear(a: [f32; 2], b: [f32; 2]) -> bool {
    let d = sub(b, a);
    let k = d[1].atan2(d[0]) / FRAC_PI_4;
    len(d) > 0.0 && (k - k.round()).abs() * FRAC_PI_4 < 1e-3
}

/// Whether `p` lies over the outlines `shape` or within `r` of them.
fn near(shape: &[Vec<[f32; 2]>], p: [f32; 2], r: f32) -> bool {
    (shape.iter())
        .any(|poly| inside(p, poly) || sides(poly).any(|(a, b)| point_segment(p, a, b) < r))
}

#[test]
fn every_pair_bridged_gate_to_gate() {
    for set in [three(), four(), five()] {
        let (at, _, all) = laid(set);
        let mut pairs: Vec<_> = all.iter().map(|b| (b.a.0, b.b.0)).collect();
        pairs.sort_unstable();
        let n = set.len();
        let want: Vec<_> = (0..n)
            .flat_map(|i| (i + 1..n).map(move |j| (i, j)))
            .collect();
        assert_eq!(pairs, want);
        for b in &all {
            let (start, end) = (b.points[0], b.points[b.points.len() - 1]);
            let node = |(i, n): (usize, u32)| add(set[i].nodes[n as usize], at[i]);
            assert!(len(sub(start, node(b.a))) <= 0.01, "{b:?}");
            assert!(len(sub(end, node(b.b))) <= 0.01, "{b:?}");
            let (ga, gb) = (gate(&set[b.a.0], b.a.1), gate(&set[b.b.0], b.b.1));
            assert!(ga.neighbours.contains(&(b.b.0 as u32 - 1)), "{ga:?}");
            assert!(gb.neighbours.contains(&(b.a.0 as u32)), "{gb:?}");
        }
    }
}

#[test]
fn bridges_are_octilinear_and_leave_square() {
    for set in [four(), five()] {
        for b in &laid(set).2 {
            let p = &b.points;
            assert!(p.windows(2).all(|w| octilinear(w[0], w[1])), "{b:?}");
            let (first, last) = (sub(p[1], p[0]), sub(p[p.len() - 1], p[p.len() - 2]));
            let (da, db) = (gate(&set[b.a.0], b.a.1).dir, gate(&set[b.b.0], b.b.1).dir);
            assert!(len(first) >= 30.0 - 1e-2, "{b:?}");
            assert!(len(last) >= 30.0 - 1e-2, "{b:?}");
            let along = |v: [f32; 2], d: [f32; 2]| (v[0] * d[0] + v[1] * d[1]) / len(v);
            assert!(along(first, da) > 1.0 - 1e-4, "{b:?} {da:?}");
            assert!(along(last, db) < -1.0 + 1e-4, "{b:?} {db:?}");
        }
    }
}

/// No point of a bridge (every 6 m) lies over the outline of an island but its own two, and
/// over those only on the straight from or to their gates.
#[test]
fn bridges_avoid_third_islands() {
    for set in [four(), five()] {
        let (_, shapes, all) = laid(set);
        let shapes = &shapes;
        for b in all {
            let last = b.points.len() - 2;
            for (r, run) in b.points.windows(2).enumerate() {
                for p in probes(run) {
                    for (k, shape) in shapes.iter().enumerate() {
                        let own = (k == b.a.0 && r == 0) || (k == b.b.0 && r == last);
                        let over = shape.iter().any(|poly| inside(p, poly));
                        assert!(own || !over, "{p:?} over island {k}: {b:?}");
                    }
                }
            }
        }
    }
}

/// Every point of a bridge (every 6 m) keeps `CLEARANCE` from every outline, but on its way
/// out of a gate: its first run from the gate until it first keeps clear of the gate's island,
/// and its last run likewise.
#[test]
fn bridges_keep_off_the_coasts() {
    for set in [four(), five()] {
        let (_, shapes, all) = laid(set);
        let shapes = &shapes;
        for b in all {
            let last = b.points.len() - 2;
            for (r, run) in b.points.windows(2).enumerate() {
                let pts = probes(run);
                let close = |k: usize| move |p: &&[f32; 2]| near(&shapes[k], **p, CLEARANCE);
                let lead = match r {
                    0 => pts.iter().take_while(close(b.a.0)).count(),
                    _ => 0,
                };
                let tail = match r == last {
                    true => pts.len() - pts.iter().rev().take_while(close(b.b.0)).count(),
                    false => pts.len(),
                };
                for (q, &p) in pts.iter().enumerate() {
                    for (k, shape) in shapes.iter().enumerate() {
                        let out = (k == b.a.0 && q < lead) || (k == b.b.0 && q >= tail);
                        let off = out || !near(shape, p, CLEARANCE - 1.0);
                        assert!(off, "{p:?} by island {k}: {b:?}");
                    }
                }
            }
        }
    }
}

#[test]
fn crossing_bridges_get_levels() {
    let crosses = |x: &Bridge, y: &Bridge| {
        (x.points.windows(2))
            .any(|s| (y.points.windows(2)).any(|t| crossing(s[0], s[1], t[0], t[1])))
    };
    for set in [four(), five()] {
        let all = laid(set).2;
        for (i, x) in all.iter().enumerate() {
            let mut alone = true;
            for (j, y) in all.iter().enumerate() {
                if i != j && crosses(x, y) {
                    alone = false;
                    assert_ne!(x.level, y.level, "{x:?} {y:?}");
                }
            }
            if alone {
                assert_eq!(x.level, 0, "{x:?}");
            }
        }
    }
}

#[test]
fn deterministic() {
    let set = five();
    let start = Instant::now();
    let at = place(&refs(set));
    let all = bridges(&refs(set), &at);
    eprintln!("5 islands: placed and bridged in {:?}", start.elapsed());
    assert_eq!(all, bridges(&refs(set), &place(&refs(set))));
}
