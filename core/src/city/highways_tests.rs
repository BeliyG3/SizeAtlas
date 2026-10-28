use super::*;
use crate::city::CELL;
use crate::city::gates::GATE;
use crate::city::grid::distance;
use crate::city::land::{land, seeds};
use crate::city::net::STEP;
use crate::city::path::point_line;
use crate::city::rng::Rng;
use crate::city::voronoi::voronoi;
use std::f32::consts::FRAC_PI_4;
use std::sync::OnceLock;

struct Island {
    land: Grid<bool>,
    dist: Grid<i32>,
    core: [f32; 2],
}

/// A 400 000 m² island of 12 districts, built once for every test.
fn island() -> &'static Island {
    static ISLAND: OnceLock<Island> = OnceLock::new();
    ISLAND.get_or_init(|| {
        let n = 12;
        let raw: Vec<f32> = (0..n).map(|i| 1.0 / (i as f32 + 1.0).powf(0.7)).collect();
        let sum: f32 = raw.iter().sum();
        let areas: Vec<f32> = raw.iter().map(|r| r / sum * 400_000.0).collect();
        let mut rng = Rng::new(7);
        let mut at = seeds(n, &mut rng);
        let land = land(&areas, &mut at, 60.0, &mut rng);
        let cells = land.data.iter().filter(|&&l| l).count() as f32 * CELL * CELL;
        let targets: Vec<f32> = raw.iter().map(|r| r / sum * cells).collect();
        let dist = voronoi(&land, &at, &targets, 0.0, 30);
        Island {
            land,
            dist,
            core: at[0],
        }
    })
}

fn build(neighbours: &[f32]) -> Highways {
    let i = island();
    highways(&i.land, &i.dist, i.core, neighbours)
}

fn sub(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] - b[0], a[1] - b[1]]
}

fn len(v: [f32; 2]) -> f32 {
    v[0].hypot(v[1])
}

fn unit(a: f32) -> [f32; 2] {
    [a.cos(), a.sin()]
}

fn cos_between(a: [f32; 2], b: [f32; 2]) -> f32 {
    (a[0] * b[0] + a[1] * b[1]) / (len(a) * len(b))
}

fn assert_octilinear(line: &[[f32; 2]]) {
    assert!(line.len() >= 2, "{line:?}");
    for w in line.windows(2) {
        let [dx, dy] = sub(w[1], w[0]);
        assert!(dx.hypot(dy) > 1e-3, "zero-length segment {w:?}");
        let k = dy.atan2(dx) / FRAC_PI_4;
        assert!((k - k.round()).abs() * FRAC_PI_4 < 1e-3, "bad angle {w:?}");
    }
}

/// Points every 0.5 m along `line`.
fn samples(line: &[[f32; 2]]) -> Vec<[f32; 2]> {
    let mut out = Vec::new();
    for w in line.windows(2) {
        let n = (len(sub(w[1], w[0])) / 0.5).ceil().max(1.0) as usize;
        for t in 0..=n {
            let t = t as f32 / n as f32;
            out.push([
                w[0][0] + t * (w[1][0] - w[0][0]),
                w[0][1] + t * (w[1][1] - w[0][1]),
            ]);
        }
    }
    out
}

fn on_land(p: [f32; 2]) -> bool {
    let land = &island().land;
    let (x, y) = ((p[0] / CELL).floor(), (p[1] / CELL).floor());
    x >= 0.0
        && y >= 0.0
        && (x as usize) < land.w
        && (y as usize) < land.h
        && land.get(x as usize, y as usize)
}

/// One neighbour in each base direction.
const ALL_ROUND: [f32; 6] = [0.3, 1.35, 2.4, 3.44, -1.8, -0.75];

#[test]
fn six_highways_reach_the_shore_and_the_core() {
    let i = island();
    let hw = build(&[]);
    assert_eq!(hw.lines.len(), 6);
    let sea: Grid<bool> = Grid {
        data: i.land.data.iter().map(|&l| !l).collect(),
        ..i.land.clone()
    };
    let (to_sea, _) = distance(&sea);
    let (to_land, _) = distance(&i.land);
    for (k, line) in hw.lines.iter().enumerate() {
        assert_eq!(*line.last().unwrap(), i.core, "{k}");
        let s = line[0];
        let (x, y) = ((s[0] / CELL) as usize, (s[1] / CELL) as usize);
        assert!(to_sea.get(x, y) * CELL <= 7.0, "{k}: {s:?} is inland");
        let base = k as f32 * std::f32::consts::FRAC_PI_3 + 0.3;
        assert!(cos_between(sub(s, i.core), unit(base)) > 0.5, "{k}: {s:?}");
        for p in line {
            let (x, y) = ((p[0] / CELL) as usize, (p[1] / CELL) as usize);
            assert!(to_land.get(x, y) * CELL <= STEP, "{k}: {p:?} off the land");
        }
    }
    assert_eq!(hw, build(&[]), "the same input builds the same highways");
}

#[test]
fn highways_are_octilinear() {
    let hw = build(&[1.0, 2.5, -2.0, 0.2]);
    assert!(!hw.ramps.is_empty());
    for line in hw.lines.iter().chain(&hw.ring).chain(&hw.ramps) {
        assert_octilinear(line);
    }
}

#[test]
fn a_neighbour_gets_a_gate_facing_it() {
    let i = island();
    let hw = build(&[1.0]);
    assert_eq!(hw.gates.len(), 1);
    let (line, out, faced) = &hw.gates[0];
    assert_eq!(faced, &vec![0]);
    assert!(
        cos_between(*out, unit(1.0)) >= 30f32.to_radians().cos(),
        "{out:?}"
    );
    let shore = hw.lines[*line][0];
    assert!(
        cos_between(sub(shore, i.core), unit(1.0)) > 0.5,
        "{shore:?}"
    );
}

#[test]
fn two_close_neighbours_share_a_gate() {
    let hw = build(&[1.0, 1.3]);
    assert_eq!(hw.gates.len(), 1);
    assert_eq!(hw.gates[0].2, vec![0, 1]);
    let hw = build(&[1.0, -2.0, 1.3]);
    assert_eq!(hw.gates.len(), 2);
    let mut faced: Vec<Vec<usize>> = hw.gates.iter().map(|g| g.2.clone()).collect();
    faced.sort();
    assert_eq!(faced, vec![vec![0, 2], vec![1]]);
}

#[test]
fn seven_neighbours_get_a_gate_each_way() {
    let neighbours: Vec<f32> = (0..7).map(|k| k as f32 * 0.9 - 3.0).collect();
    let hw = build(&[neighbours.clone(), vec![f32::NAN]].concat());
    assert!(hw.gates.len() <= 6);
    let mut faced: Vec<usize> = hw.gates.iter().flat_map(|g| g.2.clone()).collect();
    faced.sort();
    assert_eq!(
        faced,
        (0..7).collect::<Vec<_>>(),
        "each neighbour faces one gate"
    );
}

#[test]
fn a_city_of_one_district_has_highways_and_a_ring() {
    let i = island();
    let dist = Grid {
        data: i
            .land
            .data
            .iter()
            .map(|&l| if l { 0 } else { -1 })
            .collect(),
        ..i.dist.clone()
    };
    let hw = highways(&i.land, &dist, i.core, &[2.0]);
    assert_eq!(hw.lines.len(), 6);
    assert_eq!(hw.gates.len(), 1);
    assert_eq!(hw.ring.len(), 1);
    assert_eq!(hw.ring[0].first(), hw.ring[0].last());
    for line in hw.lines.iter().chain(&hw.ramps) {
        assert_octilinear(line);
        assert!(line.iter().flatten().all(|v| v.is_finite()));
    }
}

#[test]
fn no_land_no_highways() {
    let land = Grid::new(40, 40, false);
    let dist = Grid::new(40, 40, -1);
    assert_eq!(
        highways(&land, &dist, [30.0, 30.0], &[1.0]),
        Highways::default()
    );
}

#[test]
fn no_neighbours_no_gates() {
    let hw = build(&[]);
    assert_eq!(hw.lines.len(), 6);
    assert!(hw.gates.is_empty());
    assert!(hw.ramps.is_empty());
}

#[test]
fn a_gate_runs_straight_for_90_m() {
    let hw = build(&ALL_ROUND);
    assert_eq!(hw.gates.len(), 6);
    for (g, out, _) in &hw.gates {
        let (shore, junction) = (hw.lines[*g][0], hw.lines[*g][1]);
        let straight = sub(shore, junction);
        assert!(
            (len(straight) - GATE).abs() < 1e-2,
            "{g}: {}",
            len(straight)
        );
        assert!(
            cos_between(straight, *out) > 1.0 - 1e-6,
            "{g}: {straight:?} vs {out:?}"
        );
        let k = out[1].atan2(out[0]) / FRAC_PI_4;
        assert!((k - k.round()).abs() < 1e-5, "{g}: {out:?}");
        assert!(
            samples(&[junction, shore])
                .iter()
                .all(|&p| on_land(p) || len(sub(p, shore)) < 1e-3)
        );
        // The straight ends right at the land edge.
        assert!(on_land([shore[0] - 0.1 * out[0], shore[1] - 0.1 * out[1]]));
        assert!(!on_land([shore[0] + 0.1 * out[0], shore[1] + 0.1 * out[1]]));
    }
}

#[test]
fn a_gate_junction_reaches_half_of_the_highways() {
    for neighbours in [&[1.0][..], &ALL_ROUND[..]] {
        let hw = build(neighbours);
        for (g, _, _) in &hw.gates {
            let junction = hw.lines[*g][1];
            let mut reached = vec![*g];
            for ramp in hw.ramps.iter().filter(|r| r[0] == junction) {
                let end = *ramp.last().unwrap();
                let on: Vec<usize> = (0..hw.lines.len())
                    .filter(|&h| h != *g && point_line(end, &hw.lines[h]) < 1e-2)
                    .collect();
                assert!(!on.is_empty(), "{g}: a ramp ends off the highways");
                assert!(
                    point_line(end, &hw.lines[*g]) >= 16.0,
                    "{g}: a ramp back onto its own"
                );
                reached.extend(on);
                for p in samples(ramp) {
                    assert!(
                        on_land(p) || len(sub(p, end)) <= STEP,
                        "{g}: {p:?} off the land"
                    );
                }
            }
            reached.sort();
            reached.dedup();
            assert!(reached.len() >= 3, "{g}: {reached:?}");
        }
    }
}

#[test]
fn the_ring_closes_round_the_core() {
    let i = island();
    let hw = build(&[]);
    assert_eq!(hw.ring.len(), 1);
    let ring = &hw.ring[0];
    assert_eq!(ring.first(), ring.last());
    // The core seed is inside (even-odd rule).
    let p = i.core;
    let inside = ring
        .windows(2)
        .filter(|w| (w[0][1] > p[1]) != (w[1][1] > p[1]))
        .filter(|w| {
            let t = (p[1] - w[0][1]) / (w[1][1] - w[0][1]);
            p[0] < w[0][0] + t * (w[1][0] - w[0][0])
        })
        .count();
    assert_eq!(inside % 2, 1);
    // It encloses about the core's area.
    let area = ring
        .windows(2)
        .map(|w| w[0][0] * w[1][1] - w[1][0] * w[0][1])
        .sum::<f32>()
        .abs()
        / 2.0;
    let core = i.dist.data.iter().filter(|&&l| l == 0).count() as f32 * CELL * CELL;
    assert!((area - core).abs() < 0.15 * core, "{area} vs {core}");
}
