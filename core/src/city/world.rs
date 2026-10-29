//! Where the other islands of the archipelago lie, seen from one of them.

use super::plan::{built_area, empty_ratio};
use std::cmp::Reverse;
use std::f32::consts::PI;

/// Island `i` (by size) stands on the ray `i · SPIRAL` from the biggest, radians (137.5°).
pub(crate) const SPIRAL: f32 = 137.5 * PI / 180.0;
/// The strait between the biggest island and each other one, metres.
pub(crate) const STRAIT: f32 = 110.0;

/// Radius of the circle as big as the island's land and empty space, metres.
fn radius((used, free): (u64, u64)) -> f32 {
    let built = built_area(used);
    ((built + empty_ratio(used, free) * built) / PI).sqrt()
}

/// Directions (radians, `atan2(dy, dx)`) from island `me` to every other one of `islands`
/// (`(used, free)` bytes each), in their order without `me`. The biggest root (the first of equal
/// ones) stands at the origin, the `i`-th biggest on the ray `i · 137.5°` at `R₀ + Rᵢ + 110` m.
pub fn directions(islands: &[(u64, u64)], me: usize) -> Vec<f32> {
    let mut order: Vec<usize> = (0..islands.len()).collect();
    order.sort_by_key(|&i| (Reverse(islands[i].0), i));
    let mut at = vec![[0.0f32; 2]; islands.len()];
    if let Some(&first) = order.first() {
        let r0 = radius(islands[first]);
        for (rank, &i) in order.iter().enumerate().skip(1) {
            let (d, a) = (r0 + radius(islands[i]) + STRAIT, rank as f32 * SPIRAL);
            at[i] = [d * a.cos(), d * a.sin()];
        }
    }
    let Some(&from) = at.get(me) else {
        return Vec::new();
    };
    (0..islands.len())
        .filter(|&i| i != me)
        .map(|i| (at[i][1] - from[1]).atan2(at[i][0] - from[0]))
        .collect()
}

#[cfg(test)]
#[path = "world_tests.rs"]
mod tests;
