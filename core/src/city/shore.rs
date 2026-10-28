//! The empty shore: an uneven band of empty land around the island, wide mostly away from the
//! neighbours, with a few waterfronts where the city meets the water.

use super::CELL;
use super::canal::{CANAL_WIDTH, extend, near};
use super::grid::{Grid, open_steps};
use super::rng::Rng;
use super::widths::{Profile, limits};
use std::f32::consts::SQRT_2;

/// Cell of the shore's own raster, metres: the band can reach far past the land's field.
pub(crate) const SHORE_CELL: f32 = 6.0;
/// Land cells along a side of a shore cell.
const FINE: usize = (SHORE_CELL / CELL) as usize;
/// A band bigger than this (m²) is opened by `OPENING` cells to smooth off slivers.
const OPEN_ABOVE: f32 = 20_000.0;
const OPENING: usize = 2;
/// Bisection steps on the overall width scale; they stop once the area is within 0.1%.
const ROUNDS: usize = 40;

/// The band on its own raster: cell `(x, y)` covers `origin + [x, y] · cell` to one cell further,
/// in metres from the origin of the land's field.
pub(crate) struct Shore {
    pub grid: Grid<bool>,
    pub cell: f32,
    pub origin: [f32; 2],
}

/// The mean direction (radians) towards the neighbours at `directions`: the angle of the sum of
/// their unit vectors. `None` without neighbours or when they cancel out.
pub(crate) fn face(directions: &[f32]) -> Option<f32> {
    let s = directions
        .iter()
        .fold([0.0f32; 2], |s, a| [s[0] + a.cos(), s[1] + a.sin()]);
    (s[0].hypot(s[1]) > 1e-3).then(|| s[1].atan2(s[0]))
}

/// The empty band of `area` m² around `land` (on the land's field), outside the land and the
/// water of `canal` (its axis in field metres, empty without a canal), carried on to the band's
/// outer edge. Its width in the direction `θ` from the middle of the land's edge follows
/// `exp(1.1·g/σ − 1.4·cos(θ − face))` (see [`limits`]), the cosine left out without `face`; 2–3
/// waterfronts without the band take 12–25% of the edge, the first facing `face`. A band over
/// 20 000 m² is opened by 2 cells, together with the land so the strips along the land stay; the
/// overall width is then fitted to `area` by bisection. The band lies on its own raster of
/// `SHORE_CELL` metres, as big as it needs.
pub(crate) fn shore(
    land: &Grid<bool>,
    canal: &[[f32; 2]],
    area: f32,
    face: Option<f32>,
    rng: &mut Rng,
) -> Shore {
    let profile = Profile::new(face, rng);
    let target = (area.max(0.0) / (SHORE_CELL * SHORE_CELL)).round() as usize;
    // Room for the band around the land's field (cells left, above, right, below), doubled on
    // every side the band runs into until it keeps off the raster's edge.
    let mut pad = [((0.5 * area.max(0.0).sqrt() + 30.0) / SHORE_CELL).ceil() as usize; 4];
    loop {
        let (shore, hit) = lay(land, canal, target, &profile, pad);
        if !hit.contains(&true) {
            return shore;
        }
        for (p, h) in pad.iter_mut().zip(hit) {
            if h {
                *p *= 2;
            }
        }
    }
}

/// The band of `target` cells on a raster with `pad` cells of room around the land's field (left,
/// above, right, below), and whether it runs into each of those sides of the raster.
fn lay(
    land: &Grid<bool>,
    canal: &[[f32; 2]],
    target: usize,
    profile: &Profile,
    pad: [usize; 4],
) -> (Shore, [bool; 4]) {
    let w = land.w.div_ceil(FINE) + pad[0] + pad[2];
    let h = land.h.div_ceil(FINE) + pad[1] + pad[3];
    let origin = [-(pad[0] as f32) * SHORE_CELL, -(pad[1] as f32) * SHORE_CELL];
    // A shore cell holding any land is land.
    let mut dry = Grid::new(w, h, false);
    for (i, _) in land.data.iter().enumerate().filter(|(_, l)| **l) {
        dry.set(i % land.w / FINE + pad[0], i / land.w / FINE + pad[1], true);
    }
    // No shore cell reaches the canal's water cells.
    let reach = (w.max(h) as f32) * SHORE_CELL * SQRT_2;
    let wet = near(
        &extend(canal, reach),
        w,
        h,
        SHORE_CELL,
        origin,
        0.5 * CANAL_WIDTH + (SHORE_CELL + CELL) * 0.5 * SQRT_2,
    );
    let limit = limits(&dry, &wet, profile);
    let opening = target as f32 * SHORE_CELL * SHORE_CELL > OPEN_ABOVE;
    let band = |m: f32| {
        let data = if opening {
            let with_land = limit.data.iter().zip(&dry.data);
            let with_land = with_land.map(|(&t, &l)| t <= m || l).collect();
            let opened = open_steps(
                &Grid {
                    w,
                    h,
                    data: with_land,
                },
                OPENING,
            );
            opened
                .data
                .iter()
                .zip(&dry.data)
                .map(|(&o, &l)| o && !l)
                .collect()
        } else {
            limit.data.iter().map(|&t| t <= m).collect()
        };
        Grid { w, h, data }
    };
    let top = limit
        .data
        .iter()
        .copied()
        .filter(|t| t.is_finite())
        .fold(0.0f32, f32::max);
    let tolerance = (target / 1000).max(1);
    let sides = |g: &Grid<bool>| {
        [
            (0..h).any(|y| g.get(0, y)),
            (0..w).any(|x| g.get(x, 0)),
            (0..h).any(|y| g.get(w - 1, y)),
            (0..w).any(|x| g.get(x, h - 1)),
        ]
    };
    let (mut lo, mut hi) = (0.0f32, top);
    let (mut miss, mut best) = (target, Grid::new(w, h, false));
    for _ in 0..ROUNDS {
        if miss <= tolerance {
            break;
        }
        let m = 0.5 * (lo + hi);
        let got = band(m);
        let n = got.data.iter().filter(|&&b| b).count();
        // The band only grows with the scale: one short of the area that already runs into a
        // side needs more room.
        if n < target && sides(&got).contains(&true) {
            best = got;
            break;
        }
        if n.abs_diff(target) < miss {
            (miss, best) = (n.abs_diff(target), got);
        }
        if n < target { lo = m } else { hi = m }
    }
    let hit = sides(&best);
    let shore = Shore {
        grid: best,
        cell: SHORE_CELL,
        origin,
    };
    (shore, hit)
}

#[cfg(test)]
#[path = "shore_tests.rs"]
mod tests;
