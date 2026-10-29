use super::*;
use crate::city::plan::{Folder, IslandInput};
use crate::city::rng::Rng;
use crate::city::{Bridge, Gate, bridges, directions, island};
use std::f32::consts::{FRAC_PI_4, PI, TAU};
use std::sync::OnceLock;
use std::time::Instant;

const GIB: u64 = 1 << 30;
/// Free space over used space, island by island (cycled).
const RATIOS: [f64; 5] = [0.5, 1.5, 0.2, 3.0, 0.8];

/// A root of `used` bytes (give or take rounding): 8 folders of 2 to 8 subfolders, which weigh
/// `u^-1.5` for a uniform `u` (a power law).
fn root(seed: u64, used: u64) -> Folder {
    let mut rng = Rng::new(seed);
    let weights: Vec<Vec<f64>> = (0..8)
        .map(|_| {
            let n = 2 + (rng.unit() * 7.0) as usize;
            (0..n)
                .map(|_| f64::from(rng.unit().max(1e-3)).powf(-1.5))
                .collect()
        })
        .collect();
    let unit = used as f64 / weights.iter().flatten().sum::<f64>();
    let mut next = 0;
    let mut folder = |size: u64, mut children: Vec<Folder>| {
        next += 1;
        children.sort_by(|a, b| b.size.cmp(&a.size));
        Folder {
            id: next,
            size,
            children,
        }
    };
    let mut children = Vec::new();
    for leaves in weights {
        let kids: Vec<Folder> = (leaves.iter())
            .map(|w| folder((w * unit) as u64 + 1, Vec::new()))
            .collect();
        let size = kids.iter().map(|k| k.size).sum();
        children.push(folder(size, kids));
    }
    let size = children.iter().map(|c| c.size).sum::<u64>() + 1;
    folder(size, children)
}

/// Islands of about `used` bytes each, biggest first, their gates facing each other by
/// `directions`; built side by side.
fn archipelago(used: &[u64]) -> Vec<Island> {
    let roots: Vec<Folder> = (used.iter().enumerate())
        .map(|(i, &u)| root(i as u64 + 1, u))
        .collect();
    assert!(roots.windows(2).all(|w| w[0].size > w[1].size));
    let sizes: Vec<(u64, u64)> = (roots.iter().enumerate())
        .map(|(i, r)| (r.size, (r.size as f64 * RATIOS[i % RATIOS.len()]) as u64))
        .collect();
    std::thread::scope(|s| {
        let builds: Vec<_> = (roots.iter().enumerate())
            .map(|(i, r)| {
                let input = IslandInput {
                    root: r.clone(),
                    free: sizes[i].1,
                    neighbours: directions(&sizes, i),
                    seed: i as u64 + 1,
                };
                s.spawn(move || island(&input))
            })
            .collect();
        builds.into_iter().map(|b| b.join().unwrap()).collect()
    })
}

fn one() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| archipelago(&[2 * GIB]))
}

fn three() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| archipelago(&[4 * GIB, 2 * GIB, GIB]))
}

/// From 2 TiB down to 1 GiB.
fn four() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| archipelago(&[2048 * GIB, 64 * GIB, 8 * GIB, GIB]))
}

fn five() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| archipelago(&[16 * GIB, 8 * GIB, 4 * GIB, 2 * GIB, GIB]))
}

fn refs(set: &[Island]) -> Vec<&Island> {
    set.iter().collect()
}

/// The island's outline polygons moved by `at`.
fn outline(island: &Island, at: [f32; 2]) -> Vec<Vec<[f32; 2]>> {
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

fn add(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] + b[0], a[1] + b[1]]
}

fn sub(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] - b[0], a[1] - b[1]]
}

fn len(a: [f32; 2]) -> f32 {
    a[0].hypot(a[1])
}

fn cross(o: [f32; 2], p: [f32; 2], q: [f32; 2]) -> f32 {
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
}

fn point_segment(p: [f32; 2], a: [f32; 2], b: [f32; 2]) -> f32 {
    let (ab, ap) = (sub(b, a), sub(p, a));
    let t = ((ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1]).max(1e-12))
        .clamp(0.0, 1.0);
    len([ap[0] - t * ab[0], ap[1] - t * ab[1]])
}

/// Whether the segments `a`-`b` and `c`-`d` cross at a point inside both.
fn crossing(a: [f32; 2], b: [f32; 2], c: [f32; 2], d: [f32; 2]) -> bool {
    cross(a, b, c) * cross(a, b, d) < 0.0 && cross(c, d, a) * cross(c, d, b) < 0.0
}

fn inside(p: [f32; 2], poly: &[[f32; 2]]) -> bool {
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

fn sides(poly: &[[f32; 2]]) -> impl Iterator<Item = ([f32; 2], [f32; 2])> + '_ {
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

fn gate(island: &Island, node: u32) -> &Gate {
    island.gates.iter().find(|g| g.node == node).unwrap()
}

fn octilinear(a: [f32; 2], b: [f32; 2]) -> bool {
    let d = sub(b, a);
    let k = d[1].atan2(d[0]) / FRAC_PI_4;
    len(d) > 0.0 && (k - k.round()).abs() * FRAC_PI_4 < 1e-3
}

/// Points every 6 m or less along the bridge, its corners included.
fn probes(points: &[[f32; 2]]) -> Vec<[f32; 2]> {
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
        assert!(gaps.iter().all(|&g| g >= STRAIT - 6.0), "{i}: {gaps:?}");
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
fn every_pair_bridged_gate_to_gate() {
    let set = three();
    let at = place(&refs(set));
    let all = bridges(&refs(set), &at);
    let mut pairs: Vec<_> = all.iter().map(|b| (b.a.0, b.b.0)).collect();
    pairs.sort_unstable();
    assert_eq!(pairs, [(0, 1), (0, 2), (1, 2)]);
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

#[test]
fn bridges_are_octilinear_and_leave_square() {
    let set = five();
    let at = place(&refs(set));
    let all = bridges(&refs(set), &at);
    assert!(!all.is_empty());
    for b in &all {
        let p = &b.points;
        assert!(p.windows(2).all(|w| octilinear(w[0], w[1])), "{b:?}");
        let (first, last) = (sub(p[1], p[0]), sub(p[p.len() - 1], p[p.len() - 2]));
        let (da, db) = (gate(&set[b.a.0], b.a.1).dir, gate(&set[b.b.0], b.b.1).dir);
        assert!(
            len(first) >= 30.0 - 1e-2 && len(last) >= 30.0 - 1e-2,
            "{b:?}"
        );
        let along = |v: [f32; 2], d: [f32; 2]| (v[0] * d[0] + v[1] * d[1]) / len(v);
        assert!(along(first, da) > 1.0 - 1e-4, "{b:?} {da:?}");
        assert!(along(last, db) < -1.0 + 1e-4, "{b:?} {db:?}");
    }
}

/// No point of a bridge (every 6 m) lies over the outline of an island but its own two, and
/// over those only on the straight from or to their gates.
#[test]
fn bridges_avoid_third_islands() {
    let set = five();
    let at = place(&refs(set));
    let shapes: Vec<_> = set.iter().zip(&at).map(|(s, &a)| outline(s, a)).collect();
    let all = bridges(&refs(set), &at);
    assert!(all.len() >= set.len(), "{}", all.len());
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

#[test]
fn crossing_bridges_get_levels() {
    let set = five();
    let at = place(&refs(set));
    let all = bridges(&refs(set), &at);
    let crosses = |x: &Bridge, y: &Bridge| {
        (x.points.windows(2))
            .any(|s| (y.points.windows(2)).any(|t| crossing(s[0], s[1], t[0], t[1])))
    };
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

#[test]
fn deterministic() {
    let set = five();
    let start = Instant::now();
    let at = place(&refs(set));
    let all = bridges(&refs(set), &at);
    eprintln!("5 islands: placed and bridged in {:?}", start.elapsed());
    let again = place(&refs(set));
    assert_eq!(at, again);
    assert_eq!(all, bridges(&refs(set), &again));
}
