//! The archipelago: the islands of the open drives across their straits.

use super::chart::{WORLD_CELL, World, bounds, samples, shape};
use super::coast::{Coast, inside};
use super::grid::distance;
use super::map::Island;
use super::world::{SPIRAL, STRAIT};

/// The raster's distances are off by up to a cell's diagonal at either end; within this band of
/// `STRAIT` a contour point is measured against the outlines themselves.
const BAND: f32 = 2.0 * WORLD_CELL;
/// Bisection steps along an island's ray.
const ROUNDS: usize = 30;

/// Where each island goes: the shift added to its points. The islands come in the order of
/// [`super::directions`]; the first has the middle of its outline's bounding box at `(0, 0)`, the
/// `i`-th lies on the ray `i · SPIRAL` from there, slid in until the sea between its outline and
/// the others' narrows to `STRAIT` (measured from points every `WORLD_CELL` along its outline).
pub fn place(islands: &[&Island]) -> Vec<[f32; 2]> {
    let mut at: Vec<[f32; 2]> = Vec::with_capacity(islands.len());
    let mut placed: Vec<Vec<Vec<[f32; 2]>>> = Vec::with_capacity(islands.len());
    let mut coasts: Vec<Coast> = Vec::with_capacity(islands.len());
    // How far from the origin the placed outlines reach.
    let mut reach = 0.0f32;
    for (i, island) in islands.iter().enumerate() {
        let local = shape(island, [0.0; 2]);
        let (lo, hi) = bounds(local.iter().flatten());
        let c = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0];
        let half = (hi[0] - lo[0]).hypot(hi[1] - lo[1]) / 2.0;
        let a = i as f32 * SPIRAL;
        let shift = |t: f32| [t * a.cos() - c[0], t * a.sin() - c[1]];
        let offset = if placed.is_empty() {
            shift(0.0)
        } else {
            let world = World::new(&placed, STRAIT + BAND + WORLD_CELL);
            let (dist, _) = distance(&world.land);
            let points: Vec<[f32; 2]> = local.iter().flat_map(|p| samples(p, true)).collect();
            let clear = |o: [f32; 2]| {
                let apart = points.iter().all(|p| {
                    let q = [p[0] + o[0], p[1] + o[1]];
                    let d = (world.cell(q)).map_or(f32::INFINITY, |k| dist.data[k] * WORLD_CELL);
                    let measured = || coasts.iter().all(|c| c.distance(q, STRAIT) >= STRAIT);
                    d >= STRAIT + BAND || (d >= STRAIT - BAND && measured())
                });
                // An outline that would swallow a placed one has no point near it.
                let around = (placed.iter().flatten()).any(|poly| {
                    let p = [poly[0][0] - o[0], poly[0][1] - o[1]];
                    local.iter().any(|l| inside(p, l))
                });
                apart && !around
            };
            let (mut near, mut far) = (0.0, reach + half + STRAIT + BAND);
            for _ in 0..ROUNDS {
                let mid = (near + far) / 2.0;
                if clear(shift(mid)) {
                    far = mid;
                } else {
                    near = mid;
                }
            }
            shift(far)
        };
        reach = reach.max((offset[0] + c[0]).hypot(offset[1] + c[1]) + half);
        placed.push(shape(island, offset));
        coasts.push(Coast::new(&placed[i]));
        at.push(offset);
    }
    at
}

#[cfg(test)]
#[path = "archipelago_tests.rs"]
pub(crate) mod tests;
