use super::*;
use std::f32::consts::FRAC_PI_4;

/// A grid of `w` × `h` cells labelled by `f(x, y)`.
fn grid(w: usize, h: usize, f: impl Fn(usize, usize) -> i32) -> Grid<i32> {
    let mut g = Grid::new(w, h, -1);
    for y in 0..h {
        for x in 0..w {
            g.set(x, y, f(x, y));
        }
    }
    g
}

fn assert_octilinear(poly: &[[f32; 2]]) {
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
        let k = (b[1] - a[1]).atan2(b[0] - a[0]) / FRAC_PI_4;
        assert!((k - k.round()).abs() * FRAC_PI_4 < 1e-3, "{a:?} {b:?}");
    }
}

fn inside(p: [f32; 2], poly: &[[f32; 2]]) -> bool {
    let mut odd = false;
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0])
        {
            odd = !odd;
        }
    }
    odd
}

#[test]
fn a_rectangle_traces_to_its_corners() {
    let g = grid(10, 10, |x, y| {
        if (2..7).contains(&x) && (3..6).contains(&y) {
            2
        } else {
            -1
        }
    });
    let polys = trace(&g, 2);
    assert_eq!(polys.len(), 1);
    let c = CELL;
    assert_eq!(
        polys[0],
        vec![
            [2.0 * c, 3.0 * c],
            [7.0 * c, 3.0 * c],
            [7.0 * c, 6.0 * c],
            [2.0 * c, 6.0 * c]
        ]
    );
    assert!((area(&polys[0]) - 15.0 * c * c).abs() < 1e-3);
}

#[test]
fn a_staircase_becomes_one_diagonal() {
    // The cells on and below the diagonal of a 30 × 30 square.
    let g = grid(30, 30, |x, y| if x <= y { 0 } else { -1 });
    for fit in [Fit::Near, Fit::Inside] {
        let polys = outlines(&g, Some(0), CELL, [0.0; 2], fit);
        assert_eq!(polys.len(), 1);
        let poly = &polys[0].1;
        assert_octilinear(poly);
        assert!(poly.len() <= 6, "{poly:?}");
        assert!(area(poly) > 0.0);
    }
}

#[test]
fn an_inside_outline_stays_on_its_cells() {
    // A diamond, its sides staircases.
    let g = grid(41, 41, |x, y| {
        let d = (x as i32 - 20).abs() + (y as i32 - 20).abs();
        if d <= 15 { 1 } else { -1 }
    });
    let (_, poly) = &outlines(&g, None, CELL, [0.0; 2], Fit::Inside)[0];
    assert_octilinear(poly);
    let mut probes = 0;
    for y in 0..41 * 8 {
        for x in 0..41 * 8 {
            let p = [(x as f32 + 0.5) * CELL / 8.0, (y as f32 + 0.5) * CELL / 8.0];
            if inside(p, poly) {
                probes += 1;
                let cell = g.get((p[0] / CELL) as usize, (p[1] / CELL) as usize);
                assert_eq!(cell, 1, "{p:?}");
            }
        }
    }
    assert!(probes > 20_000, "{probes}");
}

#[test]
fn pieces_are_traced_apart_and_specks_left_out() {
    // Two squares touching at a corner, and a speck of three cells.
    let g = grid(12, 12, |x, y| {
        let a = x < 3 && y < 3;
        let b = (3..6).contains(&x) && (3..6).contains(&y);
        let speck = y == 10 && (8..11).contains(&x);
        if a || b || speck { 4 } else { -1 }
    });
    let polys = outlines(&g, None, CELL, [0.0; 2], Fit::Near);
    assert_eq!(polys.len(), 2);
    for (l, p) in &polys {
        assert_eq!(*l, 4);
        assert!((area(p) - 9.0 * CELL * CELL).abs() < 1e-3);
    }
}

#[test]
fn a_ring_keeps_only_its_outer_outline() {
    let g = grid(10, 10, |x, y| {
        let rim = (1..9).contains(&x) && (1..9).contains(&y);
        let hole = (3..7).contains(&x) && (3..7).contains(&y);
        if rim && !hole { 0 } else { 7 }
    });
    let ring = outlines(&g, Some(0), 2.0, [10.0, 20.0], Fit::Near);
    assert_eq!(ring.len(), 1);
    assert_eq!(
        ring[0].1,
        vec![[12.0, 22.0], [28.0, 22.0], [28.0, 38.0], [12.0, 38.0]]
    );
}
