use super::*;
use std::f32::consts::FRAC_PI_4;

fn dist_to_polyline(p: [f32; 2], line: &[[f32; 2]]) -> f32 {
    line.windows(2)
        .map(|w| point_segment(p, w[0], w[1]))
        .fold(f32::INFINITY, f32::min)
}

fn assert_octilinear(line: &[[f32; 2]]) {
    for w in line.windows(2) {
        let (dx, dy) = (w[1][0] - w[0][0], w[1][1] - w[0][1]);
        assert!(dx.hypot(dy) > 1e-3, "zero-length segment {w:?}");
        let k = dy.atan2(dx) / FRAC_PI_4;
        assert!((k - k.round()).abs() * FRAC_PI_4 < 1e-3, "bad angle {w:?}");
    }
}

#[test]
fn shortest_prefers_cheap_cells() {
    let mut cost = Grid::new(30, 9, 9.0f32);
    for x in 0..30 {
        cost.set(x, 4, 1.0);
    }
    let pred = shortest(&cost, (0, 4));
    let path = walk_back(&pred, (29, 4));
    assert_eq!(path.first(), Some(&(29, 4)));
    assert_eq!(path.last(), Some(&(0, 4)));
    assert!(path.iter().all(|&(_, y)| y == 4), "{path:?}");
    assert_eq!(path.len(), 30);
}

#[test]
fn shortest_does_not_cross_walls() {
    let mut cost = Grid::new(12, 12, 1.0f32);
    for y in 0..11 {
        cost.set(6, y, f32::INFINITY); // wall with a gap at the bottom row
    }
    let pred = shortest(&cost, (0, 0));
    let path = walk_back(&pred, (11, 0));
    assert!(path.len() > 12, "must go around: {path:?}");
    assert!(path.iter().all(|&(x, y)| cost.get(x, y).is_finite()));
    assert!(path.iter().any(|&(x, y)| x == 6 && y == 11));
    // No squeezing diagonally between two blocked cells.
    let mut diag = Grid::new(3, 3, 1.0f32);
    diag.set(1, 0, f32::INFINITY);
    diag.set(0, 1, f32::INFINITY);
    let pred = shortest(&diag, (0, 0));
    assert_eq!(pred.get(1, 1), u32::MAX, "cut off");
    assert_eq!(walk_back(&pred, (1, 1)), vec![(1, 1)]);
}

#[test]
fn shortest_marks_start_and_unreachable_cells() {
    let mut cost = Grid::new(5, 1, 1.0f32);
    cost.set(2, 0, f32::INFINITY);
    let pred = shortest(&cost, (0, 0));
    assert_eq!(pred.get(0, 0), u32::MAX);
    assert_eq!(pred.get(1, 0), 0);
    assert_eq!(pred.get(4, 0), u32::MAX);
}

fn staircase(n: usize) -> Vec<[f32; 2]> {
    let mut v = vec![[0.0, 0.0]];
    for i in 0..n {
        v.push([(i + 1) as f32, i as f32]);
        v.push([(i + 1) as f32, (i + 1) as f32]);
    }
    v
}

#[test]
fn octilinear_turns_a_staircase_into_one_diagonal() {
    let out = octilinear(&staircase(20), 1.0);
    assert_eq!(out, vec![[0.0, 0.0], [20.0, 20.0]]);
}

#[test]
fn octilinear_keeps_every_angle_a_multiple_of_45() {
    let (w, h) = (48, 48);
    let mut seed = 7u32;
    let mut cost = Grid::new(w, h, 1.0f32);
    for c in cost.data.iter_mut() {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        *c = 1.0 + ((seed >> 24) % 10) as f32;
    }
    let pred = shortest(&cost, (1, 2));
    let mut cells = walk_back(&pred, (46, 44));
    cells.reverse();
    let pts: Vec<[f32; 2]> = cells.iter().map(|&(x, y)| [x as f32, y as f32]).collect();
    assert!(pts.len() > 40);
    let tol = 1.5;
    let out = octilinear(&pts, tol);
    assert_eq!(out.first(), pts.first());
    assert_eq!(out.last(), pts.last());
    assert_octilinear(&out);
    for p in &pts {
        assert!(dist_to_polyline(*p, &out) <= tol + 1e-4, "{p:?} too far");
    }
    assert!(out.len() < pts.len() / 2, "{} of {}", out.len(), pts.len());
}

#[test]
fn octilinear_splits_a_shallow_line_into_two_segments() {
    let slope = 22.5f32.to_radians().tan();
    let pts: Vec<[f32; 2]> = (0..=30).map(|x| [x as f32, x as f32 * slope]).collect();
    let out = octilinear(&pts, 7.0);
    assert_eq!(out.len(), 3, "{out:?}");
    assert_octilinear(&out);
    assert_eq!(out[0], pts[0]);
    assert_eq!(out[2], pts[30]);
    let (a, b) = (out[1][0] - out[0][0], out[1][1] - out[0][1]);
    let (c, d) = (out[2][0] - out[1][0], out[2][1] - out[1][1]);
    // One horizontal and one diagonal piece, in either order.
    let horizontal = |dy: f32| dy.abs() < 1e-3;
    let diagonal = |dx: f32, dy: f32| (dx.abs() - dy.abs()).abs() < 1e-3;
    assert!(
        (horizontal(b) && diagonal(c, d)) || (diagonal(a, b) && horizontal(d)),
        "{out:?}"
    );
}

#[test]
fn octilinear_handles_tiny_inputs() {
    assert!(octilinear(&[], 1.0).is_empty());
    assert_eq!(octilinear(&[[1.0, 2.0]], 1.0), vec![[1.0, 2.0]]);
    // Two points that are not at a multiple of 45 get a corner.
    let out = octilinear(&[[0.0, 0.0], [10.0, 3.0]], 1.0);
    assert_eq!(out.len(), 3);
    assert_octilinear(&out);
}
