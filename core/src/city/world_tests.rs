use super::*;
use std::f32::consts::{PI, TAU};

fn same_angle(a: f32, b: f32) -> bool {
    ((a - b + PI).rem_euclid(TAU) - PI).abs() < 1e-5
}

#[test]
fn directions_match_the_scheme() {
    let gib = 1u64 << 30;
    let pair = [(40 * gib, 10 * gib), (40 * gib, 10 * gib)];
    let spiral = 137.5f32.to_radians();
    assert_eq!(directions(&pair, 0).len(), 1);
    assert!(same_angle(directions(&pair, 0)[0], spiral));
    assert!(same_angle(directions(&pair, 1)[0], spiral + PI));

    // The biggest root stands at the origin whatever its place in the list; the others follow
    // the spiral by size, each `R₀ + Rᵢ + 110` m out.
    let three = [(gib, 0), (90 * gib, 5 * gib), (20 * gib, 30 * gib)];
    let to = directions(&three, 1);
    assert_eq!(to.len(), 2);
    assert!(same_angle(to[0], 2.0 * spiral), "{to:?}");
    assert!(same_angle(to[1], spiral), "{to:?}");
    let radius = |(used, free): (u64, u64)| {
        let b = built_area(used);
        ((b + empty_ratio(used, free) * b) / PI).sqrt()
    };
    let at = |rank: f32, i: usize| {
        let d = radius(three[1]) + radius(three[i]) + 110.0;
        [d * (rank * spiral).cos(), d * (rank * spiral).sin()]
    };
    let (a, b) = (at(2.0, 0), at(1.0, 2));
    let from_small = directions(&three, 0);
    assert!(same_angle(from_small[0], (-a[1]).atan2(-a[0])));
    assert!(same_angle(from_small[1], (b[1] - a[1]).atan2(b[0] - a[0])));
}

#[test]
fn a_lone_island_has_no_neighbours() {
    assert!(directions(&[(1 << 30, 0)], 0).is_empty());
    assert!(directions(&[], 0).is_empty());
}
