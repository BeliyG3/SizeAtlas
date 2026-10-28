use super::*;
use crate::city::canal::{canal, water};
use crate::city::land::{land, seeds};
use crate::city::path::point_line;
use crate::city::widths::Profile;
use std::f32::consts::{PI, SQRT_2};
use std::sync::OnceLock;

/// The land of 10 districts adding up to `total` m², and the core's seed.
fn island(total: f32, seed: u64) -> (Grid<bool>, [f32; 2]) {
    let n = 10;
    let raw: Vec<f32> = (0..n).map(|i| 1.0 / (i as f32 + 1.0).powf(0.7)).collect();
    let sum: f32 = raw.iter().sum();
    let areas: Vec<f32> = raw.iter().map(|r| r / sum * total).collect();
    let mut rng = Rng::new(seed);
    let mut at = seeds(n, &mut rng);
    let land = land(&areas, &mut at, 30.0, &mut rng);
    (land, at[0])
}

fn islands() -> &'static [(Grid<bool>, [f32; 2])] {
    static ISLANDS: OnceLock<Vec<(Grid<bool>, [f32; 2])>> = OnceLock::new();
    ISLANDS.get_or_init(|| {
        vec![
            island(400_000.0, 1),
            island(400_000.0, 2),
            island(700_000.0, 3),
        ]
    })
}

fn cells(g: &Grid<bool>) -> usize {
    g.data.iter().filter(|&&b| b).count()
}

/// The land on the shore's raster: a shore cell holding any land cell.
fn dry(s: &Shore, land: &Grid<bool>) -> Grid<bool> {
    let pad = s.origin.map(|o| (-o / s.cell).round() as usize);
    let mut out = Grid::new(s.grid.w, s.grid.h, false);
    for y in 0..land.h {
        for x in 0..land.w {
            if land.get(x, y) {
                out.set(x / FINE + pad[0], y / FINE + pad[1], true);
            }
        }
    }
    out
}

/// Centre of shore cell `i`, field metres.
fn centre(s: &Shore, i: usize) -> [f32; 2] {
    [
        s.origin[0] + ((i % s.grid.w) as f32 + 0.5) * s.cell,
        s.origin[1] + ((i / s.grid.w) as f32 + 0.5) * s.cell,
    ]
}

#[test]
fn the_shore_has_the_asked_area() {
    for (k, (land, _)) in islands().iter().enumerate() {
        for area in [50_000.0, 500_000.0] {
            for face in [None, Some(0.7)] {
                let s = shore(land, &[], area, face, &mut Rng::new(k as u64));
                let got = cells(&s.grid) as f32 * s.cell * s.cell;
                assert!(
                    (got - area).abs() <= 0.02 * area,
                    "{k}/{area}/{face:?}: {got}"
                );
                let dry = dry(&s, land);
                assert!(s.grid.data.iter().zip(&dry.data).all(|(&b, &l)| !(b && l)));
            }
        }
    }
}

#[test]
fn an_empty_shore_is_empty() {
    let (land, _) = &islands()[0];
    let s = shore(land, &[], 0.0, None, &mut Rng::new(1));
    assert_eq!(cells(&s.grid), 0);
}

/// Share of the land's edge cells without a band cell beside them.
fn bare_share(s: &Shore, land: &Grid<bool>) -> f32 {
    let dry = dry(s, land);
    let w = dry.w;
    let (mut edge, mut bare) = (0, 0);
    for i in (0..dry.data.len()).filter(|&i| dry.data[i]) {
        let around = [i - 1, i + 1, i - w, i + w];
        if around.iter().all(|&n| dry.data[n]) {
            continue;
        }
        edge += 1;
        if around.iter().all(|&n| !s.grid.data[n]) {
            bare += 1;
        }
    }
    bare as f32 / edge as f32
}

#[test]
fn waterfronts_touch_the_water() {
    for (k, (land, _)) in islands().iter().enumerate() {
        for seed in 0..4 {
            for face in [None, Some(-2.0)] {
                let mut rng = Rng::new(seed);
                let want = Profile::new(face, &mut Rng::new(seed)).front_share;
                let s = shore(land, &[], 500_000.0, face, &mut rng);
                let share = bare_share(&s, land);
                assert!(
                    (0.09..=0.28).contains(&share),
                    "{k}/{seed}/{face:?}: {share} bare"
                );
                assert!(
                    (share - want).abs() <= 0.03,
                    "{k}/{seed}/{face:?}: {share} bare, {want} wanted"
                );
            }
        }
    }
}

#[test]
fn the_wide_shore_lies_away_from_the_neighbours() {
    for (k, (land, _)) in islands().iter().enumerate() {
        for (seed, face) in [0.0f32, 1.6, 2.4, -0.8].into_iter().enumerate() {
            let s = shore(land, &[], 500_000.0, Some(face), &mut Rng::new(seed as u64));
            let dry = dry(&s, land);
            let n = cells(&dry) as f32;
            let mid = (0..dry.data.len())
                .filter(|&i| dry.data[i])
                .fold([0.0f32; 2], |m, i| {
                    let c = centre(&s, i);
                    [m[0] + c[0] / n, m[1] + c[1] / n]
                });
            // Band area over edge length on each side of the line through the middle across `face`.
            let side = |i: usize| {
                let c = centre(&s, i);
                ((c[0] - mid[0]) * face.cos() + (c[1] - mid[1]) * face.sin() > 0.0) as usize
            };
            let (mut band, mut edge) = ([0.0f32; 2], [0.0f32; 2]);
            let w = dry.w;
            for i in 0..dry.data.len() {
                if s.grid.data[i] {
                    band[side(i)] += 1.0;
                }
                if dry.data[i] && [i - 1, i + 1, i - w, i + w].iter().any(|&j| !dry.data[j]) {
                    edge[side(i)] += 1.0;
                }
            }
            let (towards, away) = (band[1] / edge[1], band[0] / edge[0]);
            assert!(towards < away, "{k}/{face}: {towards} towards, {away} away");
        }
    }
}

#[test]
fn the_shore_stays_out_of_the_canal() {
    let (land, core) = &islands()[2];
    let axis = (0..)
        .find_map(|seed| canal(land, *core, &mut Rng::new(seed)))
        .unwrap();
    let wet = water(&axis, land.w, land.h);
    let far = extend(&axis, 1e5);
    let s = shore(land, &axis, 500_000.0, Some(1.0), &mut Rng::new(4));
    let got = cells(&s.grid) as f32 * s.cell * s.cell;
    assert!((got - 500_000.0).abs() <= 0.02 * 500_000.0, "{got}");
    let mut beside = 0;
    for i in (0..s.grid.data.len()).filter(|&i| s.grid.data[i]) {
        let c = centre(&s, i);
        // The whole cell keeps half the canal's width off the axis carried on out to sea.
        let off = point_line(c, &far);
        assert!(
            off >= 13.0 + 0.5 * SQRT_2 * s.cell,
            "{c:?}: {off} m off the axis"
        );
        beside += (off < 40.0) as usize;
        // And holds no water cell of the land's field.
        let pad = s.origin.map(|o| (-o / s.cell).round() as isize);
        let (x0, y0) = (
            (i % s.grid.w) as isize - pad[0],
            (i / s.grid.w) as isize - pad[1],
        );
        for y in y0 * FINE as isize..(y0 + 1) * FINE as isize {
            for x in x0 * FINE as isize..(x0 + 1) * FINE as isize {
                let inside = x >= 0 && y >= 0 && (x as usize) < wet.w && (y as usize) < wet.h;
                assert!(!inside || !wet.get(x as usize, y as usize));
            }
        }
    }
    assert!(beside > 0, "the canal does not cut the band");
}

#[test]
fn deterministic() {
    let (land, core) = &islands()[2];
    let run = || {
        let mut rng = Rng::new(9);
        let axis = canal(land, *core, &mut rng).unwrap_or_default();
        let s = shore(land, &axis, 300_000.0, Some(0.3), &mut rng);
        (axis, s.grid, s.origin)
    };
    assert_eq!(run(), run());
}

#[test]
fn face_is_the_mean_direction() {
    assert_eq!(face(&[]), None);
    assert_eq!(face(&[0.0, PI]), None);
    let f = face(&[0.0, 0.5 * PI]).unwrap();
    assert!((f - 0.25 * PI).abs() < 1e-5);
}
