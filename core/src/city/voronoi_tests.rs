use super::*;
use crate::city::grid::{borders, label};
use crate::city::path::octilinear;
use std::f32::consts::FRAC_PI_4;

/// A 400 × 400 m square split among six seeds of unequal targets.
fn square() -> (Grid<bool>, Vec<[f32; 2]>, Vec<f32>) {
    let n = (400.0 / CELL).round() as usize;
    let mask = Grid::new(n, n, true);
    let seeds = vec![
        [200.0, 200.0],
        [80.0, 90.0],
        [320.0, 70.0],
        [330.0, 300.0],
        [90.0, 320.0],
        [210.0, 350.0],
    ];
    let shares = [0.3f32, 0.16, 0.14, 0.16, 0.12, 0.12];
    let area = (n * n) as f32 * CELL * CELL;
    (mask, seeds, shares.iter().map(|s| s * area).collect())
}

fn areas(labels: &Grid<i32>, n: usize) -> Vec<f32> {
    let mut out = vec![0.0; n];
    for &l in &labels.data {
        if l >= 0 {
            out[l as usize] += CELL * CELL;
        }
    }
    out
}

/// Midpoints of the cell edges between labels `a` and `b`, in metres, ordered along the border.
fn border_between(labels: &Grid<i32>, edge: &Grid<bool>, a: i32, b: i32) -> Vec<[f32; 2]> {
    let mut pts = Vec::new();
    for y in 0..labels.h {
        for x in 0..labels.w {
            if !edge.get(x, y) {
                continue;
            }
            let l = labels.get(x, y);
            for (nx, ny) in [(x + 1, y), (x, y + 1)] {
                if nx < labels.w && ny < labels.h {
                    let m = labels.get(nx, ny);
                    if (l, m) == (a, b) || (l, m) == (b, a) {
                        let c = |v: usize| (v as f32 + 0.5) * CELL;
                        pts.push([(c(x) + c(nx)) / 2.0, (c(y) + c(ny)) / 2.0]);
                    }
                }
            }
        }
    }
    if pts.len() < 2 {
        return pts;
    }
    // Order along the line through the two farthest points.
    let far = |from: [f32; 2], pts: &[[f32; 2]]| {
        *pts.iter()
            .max_by(|p, q| {
                let d = |r: &[f32; 2]| (r[0] - from[0]).hypot(r[1] - from[1]);
                d(p).total_cmp(&d(q))
            })
            .unwrap()
    };
    let p = far(far(pts[0], &pts), &pts);
    let q = far(p, &pts);
    let key = |r: &[f32; 2]| (r[0] - p[0]) * (q[0] - p[0]) + (r[1] - p[1]) * (q[1] - p[1]);
    pts.sort_by(|r, s| key(r).total_cmp(&key(s)));
    pts
}

#[test]
fn voronoi_borders_are_octilinear() {
    let (mask, seeds, targets) = square();
    let labels = voronoi(&mask, &seeds, &targets, 0.0, 50);
    let edge = borders(&labels);
    let mut pairs = 0;
    for a in 0..6 {
        for b in a + 1..6 {
            let pts = border_between(&labels, &edge, a, b);
            if pts.len() < 4 {
                continue;
            }
            pairs += 1;
            let line = octilinear(&pts, 1.0);
            for w in line.windows(2) {
                let (dx, dy) = (w[1][0] - w[0][0], w[1][1] - w[0][1]);
                let k = dy.atan2(dx) / FRAC_PI_4;
                assert!((k - k.round()).abs() * FRAC_PI_4 < 1e-3, "{a}-{b}: {w:?}");
            }
            // A straight-or-diagonal border, not a curve split into many pieces.
            assert!(line.len() <= 6, "{a}-{b}: {line:?}");
        }
    }
    assert!(pairs >= 6, "{pairs}");
}

#[test]
fn voronoi_hits_the_target_areas() {
    let (mask, seeds, targets) = square();
    let got = areas(&voronoi(&mask, &seeds, &targets, 0.0, 50), seeds.len());
    for (g, t) in got.iter().zip(&targets) {
        assert!((g - t).abs() <= 0.1 * t, "{got:?} vs {targets:?}");
    }
}

#[test]
fn voronoi_cells_do_not_wrap() {
    let (mask, seeds, targets) = square();
    for rot in [0.0, FRAC_PI_4] {
        let labels = voronoi(&mask, &seeds, &targets, rot, 50);
        assert!(one_piece_each(&labels, seeds.len()), "at {rot}");
    }
}

#[test]
fn voronoi_keeps_out_of_the_mask_and_survives_one_seed() {
    let mut mask = Grid::new(40, 30, false);
    for y in 5..25 {
        for x in 5..35 {
            mask.set(x, y, true);
        }
    }
    let one = voronoi(&mask, &[[30.0, 20.0]], &[600.0 * CELL * CELL], 0.3, 10);
    for (l, &m) in one.data.iter().zip(&mask.data) {
        assert_eq!(*l, if m { 0 } else { -1 });
    }
    assert!(
        voronoi(&mask, &[], &[], 0.0, 10)
            .data
            .iter()
            .all(|&l| l == -1)
    );
}

fn one_piece_each(labels: &Grid<i32>, n: usize) -> bool {
    (0..n as i32).all(|k| {
        let cell = Grid {
            w: labels.w,
            h: labels.h,
            data: labels.data.iter().map(|&l| l == k).collect(),
        };
        label(&cell).1 == 1
    })
}

#[test]
fn voronoi_cells_stay_whole_on_ragged_land() {
    use crate::city::land::{land, seeds};
    use crate::city::rng::Rng;
    // Without the merge of stray pieces this island leaves several cells in bits along its coast.
    let n = 15;
    let raw: Vec<f32> = (0..n).map(|i| 1.0 / (i as f32 + 1.0).powf(0.7)).collect();
    let sum: f32 = raw.iter().sum();
    let areas: Vec<f32> = raw.iter().map(|r| r / sum * 150_000.0).collect();
    let mut rng = Rng::new(1);
    let mut at = seeds(n, &mut rng);
    let mask = land(&areas, &mut at, 0.0, &mut rng);
    assert_eq!(label(&mask).1, 1);
    let labels = voronoi(&mask, &at, &areas, 0.0, 50);
    assert!(one_piece_each(&labels, n));
    assert!(
        labels
            .data
            .iter()
            .zip(&mask.data)
            .all(|(&l, &m)| (l >= 0) == m)
    );
}
