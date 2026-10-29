use super::*;
use crate::city::archipelago::bearings;
use crate::city::archipelago::tests::{
    add, gate, inside, len, outline, point_segment, probes, refs, sides, sub,
};
use crate::city::chart::bounds;
use crate::city::test_sets::{
    eight, five, five_real, four, four_real, four_turned, largest, six, three, three_real,
};
use crate::city::{Island, place, place_on_rays};
use std::f32::consts::{FRAC_PI_4, PI, TAU};
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
    let sets = [
        three(),
        four(),
        five(),
        three_real(),
        four_real(),
        five_real(),
        six(),
        eight(),
    ];
    for set in sets {
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

/// `p` without the points where it runs straight on: a fork of a trunk splits a straight.
fn straights(p: &[[f32; 2]]) -> Vec<[f32; 2]> {
    let mut out = vec![p[0]];
    for w in p.windows(3) {
        let (u, v) = (sub(w[1], w[0]), sub(w[2], w[1]));
        if (u[0] * v[1] - u[1] * v[0]).abs() > 1e-3 * len(u) * len(v) {
            out.push(w[1]);
        }
    }
    out.push(p[p.len() - 1]);
    out
}

/// Every run lies along a multiple of 45°; every straight (runs one after another along one
/// line are one) is at least 4 m long, those out of the gates 30 m, along the gates.
#[test]
fn bridges_are_octilinear_and_leave_square() {
    for set in [four(), five(), four_real(), five_real(), six(), eight()] {
        for b in &laid(set).2 {
            assert!(b.points.windows(2).all(|w| octilinear(w[0], w[1])), "{b:?}");
            let p = &straights(&b.points);
            assert!(
                p.windows(2).all(|w| len(sub(w[1], w[0])) >= 4.0 - 1e-3),
                "{b:?}"
            );
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
    for set in [four(), five(), four_real(), five_real()] {
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
    for set in [four(), five(), four_real(), five_real()] {
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
fn deterministic() {
    let set = five();
    let start = Instant::now();
    let at = place(&refs(set));
    let all = bridges(&refs(set), &at);
    eprintln!("5 islands: placed and bridged in {:?}", start.elapsed());
    assert_eq!(all, bridges(&refs(set), &place(&refs(set))));
}

/// The turn at every corner of `p`, radians.
fn turns(p: &[[f32; 2]]) -> Vec<f32> {
    (p.windows(3))
        .map(|w| {
            let (u, v) = (sub(w[1], w[0]), sub(w[2], w[1]));
            let cos = (u[0] * v[0] + u[1] * v[1]) / (len(u) * len(v));
            cos.clamp(-1.0, 1.0).acos()
        })
        .collect()
}

/// No corner of a bridge of `all` (of `set`) turns more than 45°, nor where it goes on from the
/// straights of its gates' highways.
fn assert_no_sharp_corners(set: &[Island], all: &[Bridge]) {
    for b in all {
        let (da, db) = (gate(&set[b.a.0], b.a.1).dir, gate(&set[b.b.0], b.b.1).dir);
        let (p, n) = (&b.points, b.points.len());
        let back = |q: [f32; 2], d: [f32; 2]| [q[0] - 10.0 * d[0], q[1] - 10.0 * d[1]];
        let mut line = vec![back(p[0], da)];
        line.extend_from_slice(p);
        line.push(back(p[n - 1], db));
        for t in turns(&line) {
            assert!(t <= FRAC_PI_4 + 1e-3, "{}°: {b:?}", t.to_degrees());
        }
    }
}

#[test]
fn no_sharp_corners() {
    let sets = [
        three(),
        four(),
        five(),
        three_real(),
        four_real(),
        five_real(),
        six(),
        eight(),
    ];
    for set in sets {
        assert_no_sharp_corners(set, &laid(set).2);
    }
}

/// The largest archipelago, over 4 million cells of the world raster (where the search over the
/// sea once stopped), has a bridge for every pair, none turning more than 45°, placed and
/// bridged within 3 s. Slow to build in a debug build: run with `--release -- --ignored`.
#[test]
#[ignore = "timing, run in release: cargo test -p sizeatlas-core --release -- --ignored"]
fn the_largest_archipelago_is_bridged_in_time() {
    let set = largest();
    let start = Instant::now();
    let at = place(&refs(set));
    let all = bridges(&refs(set), &at);
    let took = start.elapsed();
    eprintln!("8 largest islands: placed and bridged in {took:?}");
    let far = |(s, a): (&Island, &[f32; 2])| [a[0] + s.width, a[1] + s.height];
    let (lo, _) = bounds(&at);
    let (_, hi) = bounds(&set.iter().zip(&at).map(far).collect::<Vec<_>>());
    // The world raster: 6 m cells over the islands and 300 m of sea round.
    let cells = (hi[0] - lo[0] + 600.0) * (hi[1] - lo[1] + 600.0) / 36.0;
    assert!(cells > 4.0e6, "{cells} cells");
    let mut pairs: Vec<_> = all.iter().map(|b| (b.a.0, b.b.0)).collect();
    pairs.sort_unstable();
    let want: Vec<_> = (0..8)
        .flat_map(|i| (i + 1..8).map(move |j| (i, j)))
        .collect();
    assert_eq!(pairs, want);
    assert_no_sharp_corners(set, &all);
    assert!(took.as_secs_f32() <= 3.0, "{took:?}");
}

/// The most any gate of `set` (placed by `place`) turns off the octant of the islands it faces:
/// the mean of the directions to them, as a highway shared by several turns onto, radians.
fn aim_off(set: &[Island]) -> f32 {
    let aims = bearings(&refs(set), &place_on_rays(&refs(set)));
    let mut worst = 0.0f32;
    for (i, island) in set.iter().enumerate() {
        for g in &island.gates {
            let (s, c) = (g.neighbours.iter()).fold((0.0f32, 0.0f32), |(s, c), &n| {
                let a = aims[i][n as usize];
                (s + a.sin(), c + a.cos())
            });
            let off = (g.dir[1].atan2(g.dir[0]) - s.atan2(c) + PI).rem_euclid(TAU) - PI;
            worst = worst.max(off.abs());
        }
    }
    worst
}

/// Built facing the real directions, every gate faces the octant of the islands it serves,
/// give or take the 2° the second placement moves them; built facing directions a quarter turn
/// off, they do not.
#[test]
fn real_directions_aim_gates() {
    let near = (22.5f32 + 2.0).to_radians();
    for set in [three_real(), four_real(), five_real()] {
        let off = aim_off(set);
        assert!(off <= near, "{}°", off.to_degrees());
    }
    let off = aim_off(four_turned());
    assert!(off > near, "{}°", off.to_degrees());
}
