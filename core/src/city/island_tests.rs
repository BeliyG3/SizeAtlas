use super::*;
use crate::city::graph::{Edge, length};
use crate::city::path::point_segment;
use crate::city::plan::Folder;
use crate::city::road::road_width;
use std::collections::HashMap;
use std::f32::consts::FRAC_PI_4;
use std::sync::OnceLock;
use std::time::Instant;

const GIB: u64 = 1 << 30;
/// Directions to the neighbours of the test islands, radians.
const NEIGHBOURS: [f32; 3] = [0.4, 2.0, 4.1];
/// Free space over used space of the test islands without a canal.
const RATIOS: [f64; 3] = [0.02, 0.6, 3.0];

/// A folder with up to `fan[0]` subfolders, each with up to `fan[1]`, and so on; the files right
/// in each weigh `u^-1.5` for a uniform `u` (a power law), in units of `unit` bytes.
fn folder(rng: &mut Rng, next: &mut u32, fan: &[usize], unit: f64) -> Folder {
    let id = *next;
    *next += 1;
    let n = fan
        .first()
        .map_or(0, |&f| (rng.unit() * (f + 1) as f32) as usize);
    let mut children: Vec<Folder> = (0..n).map(|_| folder(rng, next, &fan[1..], unit)).collect();
    children.sort_by(|a, b| b.size.cmp(&a.size));
    let files = (unit * f64::from(rng.unit().max(1e-3)).powf(-1.5)) as u64 + 1;
    let size = files + children.iter().map(|c| c.size).sum::<u64>();
    Folder { id, size, children }
}

/// A root of about `used` bytes: 14 folders of up to 28 subfolders of up to 20.
fn root(seed: u64, used: u64) -> Folder {
    let mut rng = Rng::new(seed);
    // About 14 · 15 · 11 folders; `u^-1.5` over `[0.001, 1)` averages about 61.
    let unit = used as f64 / (14.0 * 15.0 * 11.0 * 61.0);
    let mut next = 0;
    let mut root = folder(&mut rng, &mut next, &[], unit);
    root.children = (0..14)
        .map(|_| folder(&mut rng, &mut next, &[28, 20], unit))
        .collect();
    root.children.sort_by(|a, b| b.size.cmp(&a.size));
    root.size = root.files() + root.children.iter().map(|c| c.size).sum::<u64>();
    root
}

/// The island of `root(seed, used)` with `r` times its size free.
fn input(seed: u64, used: u64, r: f64) -> IslandInput {
    let root = root(seed, used);
    let free = (root.size as f64 * r) as u64;
    IslandInput {
        root,
        free,
        neighbours: NEIGHBOURS.to_vec(),
        seed,
    }
}

/// A 300 000 m² island with a canal and three gates, built once.
fn town() -> &'static (Island, f32) {
    &all()[0]
}

/// The town, then one island for each of the free space ratios `RATIOS` (no canal on them).
fn all() -> &'static [(Island, f32)] {
    static ALL: OnceLock<Vec<(Island, f32)>> = OnceLock::new();
    ALL.get_or_init(|| {
        let town = assemble(&input(15, 2 * GIB, 0.6));
        let rest = RATIOS.iter().map(|&r| assemble(&input(1, 2 * GIB, r)));
        [town].into_iter().chain(rest).collect()
    })
}

fn octilinear(a: [f32; 2], b: [f32; 2]) -> bool {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let k = dy.atan2(dx) / FRAC_PI_4;
    dx.hypot(dy) > 0.0 && (k - k.round()).abs() * FRAC_PI_4 < 1e-3
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

fn bounds(points: &[[f32; 2]]) -> ([f32; 2], [f32; 2]) {
    let start = ([f32::INFINITY; 2], [f32::NEG_INFINITY; 2]);
    points.iter().fold(start, |(lo, hi), p| {
        (
            [lo[0].min(p[0]), lo[1].min(p[1])],
            [hi[0].max(p[0]), hi[1].max(p[1])],
        )
    })
}

/// Probes every 2 m inside each building (house or filler): `(polygon index, point)`.
fn probes(island: &Island) -> Vec<(usize, [f32; 2])> {
    let mut out = Vec::new();
    for (i, p) in island.polys.iter().enumerate() {
        if !matches!(p.kind, PolyKind::House | PolyKind::Filler) {
            continue;
        }
        let (lo, hi) = bounds(&p.points);
        let (x0, y0) = ((lo[0] / 2.0).ceil() as i32, (lo[1] / 2.0).ceil() as i32);
        let (x1, y1) = ((hi[0] / 2.0).floor() as i32, (hi[1] / 2.0).floor() as i32);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let q = [2.0 * x as f32, 2.0 * y as f32];
                if inside(q, &p.points) {
                    out.push((i, q));
                }
            }
        }
    }
    out
}

fn degrees(island: &Island) -> Vec<usize> {
    let mut deg = vec![0; island.nodes.len()];
    for e in &island.edges {
        deg[e.a as usize] += 1;
        deg[e.b as usize] += 1;
    }
    deg
}

fn ends(island: &Island, e: &Edge) -> ([f32; 2], [f32; 2]) {
    (island.nodes[e.a as usize], island.nodes[e.b as usize])
}

#[test]
fn every_side_and_edge_is_octilinear() {
    for (island, _) in all() {
        for p in &island.polys {
            assert!(p.points.len() >= 3, "{:?}", p.kind);
            for i in 0..p.points.len() {
                let (a, b) = (p.points[i], p.points[(i + 1) % p.points.len()]);
                assert!(octilinear(a, b), "{:?} {}: {a:?} {b:?}", p.kind, p.id);
            }
        }
        for e in &island.edges {
            let (a, b) = ends(island, e);
            assert!(octilinear(a, b), "{e:?}: {a:?} {b:?}");
        }
        let points = island.polys.iter().flat_map(|p| &p.points);
        let mut coords = points.chain(&island.nodes).flatten();
        assert!(coords.all(|v| v.is_finite() && *v >= 0.0));
    }
}

#[test]
fn houses_do_not_overlap() {
    for (island, _) in all() {
        let probes = probes(island);
        assert!(probes.len() > 10_000, "{}", probes.len());
        let mut by_point: HashMap<[i32; 2], usize> = HashMap::new();
        for (_, p) in &probes {
            *by_point.entry([p[0] as i32, p[1] as i32]).or_default() += 1;
        }
        let shared = by_point.values().filter(|&&n| n > 1).count();
        assert_eq!(shared, 0, "{shared} of {} probes", by_point.len());
    }
}

#[test]
fn houses_stay_off_the_roads() {
    for (island, _) in all() {
        // Edges by 32 m buckets of their bounding boxes, grown by half the widest road.
        let key = |v: f32| (v / 32.0).floor() as i32;
        let mut buckets: HashMap<(i32, i32), Vec<&Edge>> = HashMap::new();
        for e in &island.edges {
            let (a, b) = ends(island, e);
            let (lo, hi) = bounds(&[a, b]);
            for y in key(lo[1] - 8.0)..=key(hi[1] + 8.0) {
                for x in key(lo[0] - 8.0)..=key(hi[0] + 8.0) {
                    buckets.entry((x, y)).or_default().push(e);
                }
            }
        }
        for (poly, p) in probes(island) {
            for e in buckets.get(&(key(p[0]), key(p[1]))).into_iter().flatten() {
                let (a, b) = ends(island, e);
                let d = point_segment(p, a, b);
                let house = &island.polys[poly];
                assert!(
                    d >= 0.5 * road_width(e.class) - 0.5,
                    "{:?} {} at {p:?} is {d} m from {e:?}",
                    house.kind,
                    house.id
                );
            }
        }
    }
}

#[test]
fn the_graph_is_one_piece() {
    for (island, dropped) in all() {
        let mut near = vec![Vec::new(); island.nodes.len()];
        for e in &island.edges {
            near[e.a as usize].push(e.b as usize);
            near[e.b as usize].push(e.a as usize);
        }
        let mut seen = vec![false; island.nodes.len()];
        let mut stack = vec![0];
        seen[0] = true;
        while let Some(n) = stack.pop() {
            for &m in &near[n] {
                if !std::mem::replace(&mut seen[m], true) {
                    stack.push(m);
                }
            }
        }
        assert!(seen.iter().all(|&s| s));
        assert!(degrees(island).iter().all(|&d| d > 0));
        eprintln!("left off: {:.3}% of the road length", 100.0 * dropped);
        assert!(*dropped <= 0.02, "{dropped}");
        for class in [
            RoadClass::Highway,
            RoadClass::Ring,
            RoadClass::Ramp,
            RoadClass::Street,
            RoadClass::Lane,
        ] {
            assert!(island.edges.iter().any(|e| e.class == class), "{class:?}");
        }
    }
}

#[test]
fn the_empty_space_matches_the_free_space() {
    for (r, (island, _)) in RATIOS.iter().zip(&all()[1..]) {
        let s = island.stats;
        let want = *r as f32 * s.built;
        let got = s.inner_empty + s.shore;
        assert!(
            (got - want).abs() <= 0.05 * want,
            "{r}: {got} vs {want} ({s:?})"
        );
        assert!(s.shore > 0.0, "{r}: {s:?}");
    }
}

#[test]
fn bridges_only_cross_the_canal() {
    let (island, _) = town();
    let water: Vec<&Poly> = island
        .polys
        .iter()
        .filter(|p| p.kind == PolyKind::Water)
        .collect();
    assert_eq!(water.len(), 1);
    let bridges: Vec<&Edge> = island.edges.iter().filter(|e| e.bridge).collect();
    assert!(!bridges.is_empty());
    for e in bridges {
        let (a, b) = ends(island, e);
        let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
        assert!(inside(mid, &water[0].points), "{e:?} at {mid:?}");
        assert!(length(&island.nodes, e) <= 32.0, "{e:?}");
    }
}

#[test]
fn gates_point_at_the_neighbours() {
    let (island, _) = town();
    assert!(!island.gates.is_empty());
    let mut faced = vec![0; NEIGHBOURS.len()];
    for g in &island.gates {
        assert!((g.dir[0].hypot(g.dir[1]) - 1.0).abs() < 1e-5);
        assert!(octilinear([0.0; 2], g.dir), "{g:?}");
        let highway = island
            .edges
            .iter()
            .any(|e| e.class == RoadClass::Highway && (e.a == g.node || e.b == g.node));
        assert!(highway, "{g:?}");
        assert!(!g.neighbours.is_empty());
        for &n in &g.neighbours {
            faced[n as usize] += 1;
            let a = NEIGHBOURS[n as usize];
            let cos = g.dir[0] * a.cos() + g.dir[1] * a.sin();
            // The multiple of 45° nearest to the neighbour (to the mean of a shared gate's).
            assert!(cos >= (0.5 * FRAC_PI_4 + 0.3).cos(), "{g:?} vs {a}");
        }
    }
    // A neighbour faces one gate at most; it can lose its gate where no shore fits one.
    assert!(faced.iter().all(|&n| n <= 1), "{faced:?}");
}

#[test]
fn a_root_without_folders_still_makes_an_island() {
    let root = Folder {
        id: 5,
        size: 10 * GIB,
        children: Vec::new(),
    };
    let island = island(&IslandInput {
        root,
        free: GIB,
        neighbours: vec![1.0],
        seed: 3,
    });
    for kind in [
        PolyKind::Island,
        PolyKind::Land,
        PolyKind::District,
        PolyKind::Block,
        PolyKind::Filler,
    ] {
        let found = island.polys.iter().any(|p| p.kind == kind && p.id == 5);
        assert!(found, "{kind:?}");
    }
    assert!(island.edges.iter().any(|e| e.class == RoadClass::Highway));
    assert!(island.width > 0.0 && island.height > 0.0);
    let points = island.polys.iter().flat_map(|p| &p.points);
    let mut coords = points.chain(&island.nodes).flatten();
    assert!(coords.all(|v| v.is_finite()));
}

#[test]
fn the_same_input_gives_the_same_island() {
    assert_eq!(&island(&input(15, 2 * GIB, 0.6)), &town().0);
}

#[test]
#[ignore = "timing, run in release: cargo test -p sizeatlas-core --release -- --ignored"]
fn the_largest_island_takes_under_two_seconds() {
    // Seed 7 makes the largest island with a canal.
    let input = input(7, 2000 * GIB, 3.0);
    assert!(built_area(input.root.size) >= 1_499_000.0);
    let start = Instant::now();
    let island = island(&input);
    let took = start.elapsed().as_secs_f32();
    assert!(island.polys.iter().any(|p| p.kind == PolyKind::Water));
    eprintln!(
        "{took:.3} s, {:?}, {} polygons, {} edges",
        island.stats,
        island.polys.len(),
        island.edges.len()
    );
    assert!(took < 2.0, "{took} s");
}
