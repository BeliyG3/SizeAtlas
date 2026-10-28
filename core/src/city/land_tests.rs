use super::*;
use crate::city::grid::fill_holes;

/// Areas of `n` districts that add up to `total`, the first (the core) the biggest.
fn areas(n: usize, total: f32) -> Vec<f32> {
    let raw: Vec<f32> = (0..n).map(|i| 1.0 / (i as f32 + 1.0).powf(0.7)).collect();
    let sum: f32 = raw.iter().sum();
    raw.iter().map(|r| r / sum * total).collect()
}

fn island(n: usize, total: f32, seed: u64) -> (Grid<bool>, Vec<[f32; 2]>) {
    let mut rng = Rng::new(seed);
    let mut at = seeds(n, &mut rng);
    let land = land(&areas(n, total), &mut at, 100.0, &mut rng);
    (land, at)
}

#[test]
fn seeds_put_the_core_in_the_centre_and_the_rest_around_it() {
    let at = seeds(15, &mut Rng::new(3));
    assert_eq!(at.len(), 15);
    assert_eq!(at[0], [0.0, 0.0]);
    for (i, p) in at.iter().enumerate().skip(1) {
        let r = p[0].hypot(p[1] / 0.85);
        let ring = (i as f32).sqrt();
        assert!(r > 0.85 * ring && r < 1.2 * ring, "{i}: {p:?}");
    }
}

#[test]
fn land_has_no_holes_and_about_the_wanted_area() {
    for (n, total, seed) in [(15, 1_000_000.0, 1), (6, 150_000.0, 2), (1, 200_000.0, 3)] {
        for k in 0..4 {
            let (land, at) = island(n, total, seed * 10 + k);
            assert_eq!(fill_holes(&land), land, "holes in {n}/{seed}");
            let area = land.data.iter().filter(|&&l| l).count() as f32 * CELL * CELL;
            assert!(
                (area - total).abs() <= 0.15 * total,
                "{n}/{seed}/{k}: {area} vs {total}"
            );
            // The margin stays empty and every seed lies on the field.
            let edge = (100.0 / CELL) as usize;
            for y in 0..land.h {
                for x in 0..land.w {
                    if land.get(x, y) {
                        assert!(x >= edge && y >= edge && x + edge < land.w && y + edge < land.h);
                    }
                }
            }
            let (fw, fh) = (land.w as f32 * CELL, land.h as f32 * CELL);
            assert!(
                at.iter()
                    .all(|p| p[0] > 0.0 && p[1] > 0.0 && p[0] < fw && p[1] < fh)
            );
        }
    }
}

#[test]
fn the_same_seed_gives_the_same_land() {
    let (a, sa) = island(12, 600_000.0, 42);
    let (b, sb) = island(12, 600_000.0, 42);
    assert_eq!(a, b);
    assert_eq!(sa, sb);
    let (c, _) = island(12, 600_000.0, 43);
    assert_ne!(a, c);
}
