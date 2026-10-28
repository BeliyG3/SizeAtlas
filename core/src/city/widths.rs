//! How wide the empty shore may be in each direction around the land: an uneven width, wide mostly
//! away from the neighbours, and the waterfronts where the city meets the water.

use super::grid::{Grid, distance};
use super::rng::Rng;
use std::f32::consts::{PI, TAU};

/// Harmonics of the band's width along the edge.
const HARMONICS: usize = 5;
/// Weight of the harmonics (in their standard deviations) in the log of the width.
const NOISE: f32 = 1.1;
/// Weight of the direction away from the neighbours in the log of the width.
const AWAY: f32 = 1.4;
/// Off the waterfronts the width factor stays above this share of its mean along the edge, so the
/// side facing the neighbours keeps a little shore.
const FLOOR: f32 = 0.1;
/// ... and below this multiple of it, so the widest stretches swell into broad patches rather than
/// horns.
const CAP: f32 = 3.0;
/// Angle over which the band swells back from nothing beside a waterfront, radians.
const TAPER: f32 = 0.35;
/// Directions the width factor is tabulated at around the land.
const DIRECTIONS: usize = 4096;

/// The random shape of the band along the edge, drawn once.
pub(crate) struct Profile {
    /// `(amplitude, phase)` of harmonic `k + 1`.
    harmonics: [(f32, f32); HARMONICS],
    /// Directions of the waterfronts' middles, the first facing the neighbours.
    fronts: Vec<f32>,
    /// Share of the edge the waterfronts take together.
    pub front_share: f32,
    face: Option<f32>,
}

impl Profile {
    pub(crate) fn new(face: Option<f32>, rng: &mut Rng) -> Self {
        let mut harmonics = [(0.0, 0.0); HARMONICS];
        for (k, h) in harmonics.iter_mut().enumerate() {
            *h = (
                rng.range(0.3, 1.0) / (k as f32 + 1.0).powf(0.7),
                rng.range(0.0, TAU),
            );
        }
        let n = if rng.unit() < 0.5 { 2 } else { 3 };
        let front_share = rng.range(0.12, 0.25);
        // Spread around the edge so the waterfronts stay apart, each within a quarter of its turn.
        let first = face.unwrap_or_else(|| rng.range(-PI, PI));
        let turn = TAU / n as f32;
        let fronts = (0..n)
            .map(|i| match i {
                0 => first,
                _ => first + turn * (i as f32 + rng.range(-0.25, 0.25)),
            })
            .collect();
        Self {
            harmonics,
            fronts,
            front_share,
            face,
        }
    }

    /// The band's width factor at edge direction `a` (radians), before the waterfronts.
    fn width(&self, a: f32, sigma: f32) -> f32 {
        let away = self.face.map_or(0.0, |f| AWAY * (a - f).cos());
        (NOISE * self.noise(a) / sigma - away).exp()
    }

    fn noise(&self, a: f32) -> f32 {
        self.harmonics
            .iter()
            .enumerate()
            .map(|(k, &(amp, phase))| amp * ((k as f32 + 1.0) * a + phase).cos())
            .sum()
    }
}

/// For every cell of `dry` (the land) and `wet` (the canal's water), the overall width scale from
/// which it belongs to the band: its distance to the land over the width factor of its direction
/// `θ` from the middle of the land's edge. The factor is `exp(1.1·g/σ − 1.4·cos(θ − face))`, `g`
/// the profile's harmonics and `σ` their spread over the edge cells, kept within `FLOOR`–`CAP`
/// of its mean. Each waterfront takes the directions of its share of the edge cells and gets no
/// band, which swells back beside it over `TAPER`. Land and water get infinity.
pub(crate) fn limits(dry: &Grid<bool>, wet: &Grid<bool>, profile: &Profile) -> Grid<f32> {
    let (w, h) = (dry.w, dry.h);
    let edge: Vec<usize> = (0..w * h)
        .filter(|&i| {
            let (x, y) = (i % w, i / w);
            dry.data[i]
                && (x == 0
                    || y == 0
                    || x + 1 == w
                    || y + 1 == h
                    || !dry.data[i - 1]
                    || !dry.data[i + 1]
                    || !dry.data[i - w]
                    || !dry.data[i + w])
        })
        .collect();
    if edge.is_empty() {
        return Grid::new(w, h, f32::INFINITY);
    }
    let n = edge.len() as f32;
    let mid = edge.iter().fold([0.0f32; 2], |m, &i| {
        [m[0] + (i % w) as f32 / n, m[1] + (i / w) as f32 / n]
    });
    let direction = |i: usize| ((i / w) as f32 - mid[1]).atan2((i % w) as f32 - mid[0]);
    let angle: Vec<f32> = edge.iter().map(|&i| direction(i)).collect();
    let g: Vec<f32> = angle.iter().map(|&a| profile.noise(a)).collect();
    let g_mean = g.iter().sum::<f32>() / n;
    let sigma = (g.iter().map(|v| (v - g_mean).powi(2)).sum::<f32>() / n).sqrt() + 1e-9;
    let mean = angle.iter().map(|&a| profile.width(a, sigma)).sum::<f32>() / n;
    // Each waterfront takes the edge cells nearest its direction that are not taken yet, and so
    // the directions up to the farthest of them.
    let off = |a: f32, c: f32| {
        let d = (a - c).rem_euclid(TAU);
        d.min(TAU - d)
    };
    let each = (profile.front_share / profile.fronts.len() as f32 * n) as usize;
    let mut taken = vec![false; edge.len()];
    let mut arcs = Vec::new();
    for &c in &profile.fronts {
        let mut free: Vec<usize> = (0..edge.len()).filter(|&k| !taken[k]).collect();
        free.sort_by(|&a, &b| {
            off(angle[a], c)
                .total_cmp(&off(angle[b], c))
                .then(a.cmp(&b))
        });
        free.truncate(each);
        if let Some(&last) = free.last() {
            arcs.push((c, off(angle[last], c)));
        }
        for k in free {
            taken[k] = true;
        }
    }
    let table: Vec<f32> = (0..DIRECTIONS)
        .map(|b| {
            let a = -PI + (b as f32 + 0.5) * TAU / DIRECTIONS as f32;
            // Past a waterfront the band swells back over `TAPER` radians.
            let gap = arcs
                .iter()
                .map(|&(c, half)| off(a, c) - half)
                .fold(f32::INFINITY, f32::min);
            if gap <= 0.0 {
                return 0.0;
            }
            let s = (gap / TAPER).min(1.0);
            let taper = s * s * (3.0 - 2.0 * s);
            (profile.width(a, sigma).min(CAP * mean) * taper).max(FLOOR * mean)
        })
        .collect();
    let (dist, _) = distance(dry);
    let data = (0..w * h)
        .map(|i| {
            let bin = ((direction(i) + PI) / TAU * DIRECTIONS as f32) as usize;
            let f = table[bin.min(DIRECTIONS - 1)];
            if dry.data[i] || wet.data[i] || f <= 0.0 {
                f32::INFINITY
            } else {
                dist.data[i] / f
            }
        })
        .collect();
    Grid { w, h, data }
}
