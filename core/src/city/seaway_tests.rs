use super::*;
use std::f32::consts::FRAC_1_SQRT_2;

/// A 200 m square from `lo`.
fn square(lo: [f32; 2]) -> Vec<Vec<[f32; 2]>> {
    let [x, y] = lo;
    let (u, v) = (x + 200.0, y + 200.0);
    vec![vec![[x, y], [u, y], [u, v], [x, v]]]
}

fn coasts(shapes: &[Vec<Vec<[f32; 2]>>]) -> Vec<Coast> {
    shapes.iter().map(|s| Coast::new(s)).collect()
}

fn assert_line(got: Option<Vec<[f32; 2]>>, want: &[[f32; 2]]) {
    let got = got.expect("a bridge");
    assert_eq!(got.len(), want.len(), "{got:?}");
    for (p, q) in got.iter().zip(want) {
        assert!(
            (p[0] - q[0]).hypot(p[1] - q[1]) < 0.01,
            "{got:?} vs {want:?}"
        );
    }
}

/// A way with a single corner (east, then south-east), both straights a few metres off the
/// raster's lines: the corner lies where the two straights cross.
#[test]
fn a_single_corner_lies_on_both_straights() {
    let (a, corner) = ([-100.0, 1.7], [200.0, 1.7]);
    let b = [
        corner[0] + 150.0 * FRAC_1_SQRT_2,
        corner[1] + 150.0 * FRAC_1_SQRT_2,
    ];
    let shapes = [square([-300.0, -100.0]), square(b)];
    let (pa, pb) = ((0, a, [1.0, 0.0]), (1, b, [-FRAC_1_SQRT_2, -FRAC_1_SQRT_2]));
    let mut sea = Sea::new(&shapes);
    let (from, to) = (sea.out(&coasts(&shapes), pa), sea.out(&coasts(&shapes), pb));
    let way = sea.cheapest(from.unwrap(), 0, to.unwrap()).unwrap();
    assert_eq!(way.len(), 3, "{way:?}");
    assert_line(sea.route(&coasts(&shapes), pa, pb), &[a, corner, b]);
}

/// Both straights set out from the same cell: they meet where they cross, the shortest way.
#[test]
fn straights_from_one_cell_meet() {
    let (a, b) = ([-100.0, 1.7], [-57.0, -39.3]);
    let shapes = [square([-300.0, -20.0]), square([-157.0, -239.3])];
    let (pa, pb) = ((0, a, [1.0, 0.0]), (1, b, [0.0, 1.0]));
    let mut sea = Sea::new(&shapes);
    let from = sea.out(&coasts(&shapes), pa);
    assert!(from.is_some());
    assert_eq!(from, sea.out(&coasts(&shapes), pb));
    assert_line(sea.route(&coasts(&shapes), pa, pb), &[a, [-57.0, 1.7], b]);
}
