use super::*;
use crate::city::land::{land, seeds};
use crate::city::path::point_line;
use std::f32::consts::FRAC_PI_4;
use std::sync::OnceLock;

/// The land of `n` districts adding up to `total` m², and the core's seed.
fn island(n: usize, total: f32, seed: u64) -> (Grid<bool>, [f32; 2]) {
    let raw: Vec<f32> = (0..n).map(|i| 1.0 / (i as f32 + 1.0).powf(0.7)).collect();
    let sum: f32 = raw.iter().sum();
    let areas: Vec<f32> = raw.iter().map(|r| r / sum * total).collect();
    let mut rng = Rng::new(seed);
    let mut at = seeds(n, &mut rng);
    let land = land(&areas, &mut at, 30.0, &mut rng);
    (land, at[0])
}

fn big() -> &'static (Grid<bool>, [f32; 2]) {
    static BIG: OnceLock<(Grid<bool>, [f32; 2])> = OnceLock::new();
    BIG.get_or_init(|| island(12, 800_000.0, 5))
}

fn on_land(land: &Grid<bool>, p: [f32; 2]) -> bool {
    let (x, y) = ((p[0] / CELL).floor(), (p[1] / CELL).floor());
    x >= 0.0 && y >= 0.0 && (x as usize) < land.w && (y as usize) < land.h && {
        land.get(x as usize, y as usize)
    }
}

#[test]
fn a_canal_crosses_the_island_and_leaves_it_on_both_sides() {
    let (land, core) = big();
    let mut found = 0;
    for seed in 0..60 {
        let Some(axis) = canal(land, *core, &mut Rng::new(seed)) else {
            continue;
        };
        found += 1;
        assert_eq!(axis.len(), 4, "{seed}");
        let dirs: Vec<f32> = axis
            .windows(2)
            .map(|s| (s[1][1] - s[0][1]).atan2(s[1][0] - s[0][0]))
            .collect();
        for d in &dirs {
            let off = (d / FRAC_PI_4 - (d / FRAC_PI_4).round()).abs() * FRAC_PI_4;
            assert!(off < 1e-3, "{seed}: {dirs:?}");
        }
        assert!(
            (dirs[0] - dirs[2]).abs() < 1e-3,
            "{seed}: legs not parallel"
        );
        assert!((dirs[1] - dirs[0]).abs() > 0.7, "{seed}: no 45° jog");
        // Walking the axis: off the land, onto it, and off it again, the ends far out at sea.
        let mut runs = Vec::new();
        for s in axis.windows(2) {
            let len = (s[1][0] - s[0][0]).hypot(s[1][1] - s[0][1]);
            for k in 0..(len as usize) {
                let t = k as f32 / len;
                let p = [
                    s[0][0] + t * (s[1][0] - s[0][0]),
                    s[0][1] + t * (s[1][1] - s[0][1]),
                ];
                let dry = on_land(land, p);
                if runs.last() != Some(&dry) {
                    runs.push(dry);
                }
            }
        }
        assert_eq!(runs.first(), Some(&false), "{seed}");
        assert_eq!(runs.last(), Some(&false), "{seed}");
        assert!(runs.contains(&true), "{seed}: the canal misses the land");
        for end in [axis[0], axis[3]] {
            let nearest = land
                .data
                .iter()
                .enumerate()
                .filter(|(_, l)| **l)
                .map(|(i, _)| {
                    let c = [
                        ((i % land.w) as f32 + 0.5) * CELL,
                        ((i / land.w) as f32 + 0.5) * CELL,
                    ];
                    (c[0] - end[0]).hypot(c[1] - end[1])
                })
                .fold(f32::INFINITY, f32::min);
            assert!(nearest > 390.0, "{seed}: an end {nearest} m from the land");
        }
    }
    assert!(found >= 10, "only {found} canals");
}

#[test]
fn small_islands_have_no_canal() {
    let (land, core) = island(6, 250_000.0, 3);
    for seed in 0..100 {
        assert_eq!(canal(&land, core, &mut Rng::new(seed)), None);
    }
}

#[test]
fn about_a_third_of_seeds_give_a_canal() {
    let (land, core) = big();
    let n = (0..300)
        .filter(|&s| canal(land, *core, &mut Rng::new(s)).is_some())
        .count();
    assert!((60..=135).contains(&n), "{n} of 300");
}

#[test]
fn water_lies_within_half_the_canal_width() {
    let axis = vec![[-50.0, 40.0], [60.0, 40.0], [100.0, 80.0], [300.0, 80.0]];
    let (w, h) = (120, 90);
    let wet = water(&axis, w, h);
    for y in 0..h {
        for x in 0..w {
            let c = [(x as f32 + 0.5) * CELL, (y as f32 + 0.5) * CELL];
            assert_eq!(wet.get(x, y), point_line(c, &axis) < 13.0, "{x}, {y}");
        }
    }
}

#[test]
fn extend_carries_the_ends_out() {
    let axis = [[0.0, 0.0], [10.0, 0.0], [20.0, 10.0]];
    let out = extend(&axis, 5.0);
    assert_eq!(out[0], [-5.0, 0.0]);
    assert_eq!(out[1], [10.0, 0.0]);
    let s = 5.0 * FRAC_1_SQRT_2;
    assert!((out[2][0] - 20.0 - s).abs() < 1e-4 && (out[2][1] - 10.0 - s).abs() < 1e-4);
}
