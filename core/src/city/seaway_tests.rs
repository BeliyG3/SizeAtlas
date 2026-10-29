use super::*;
use std::f32::consts::{FRAC_1_SQRT_2, FRAC_PI_4};

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
    let way = sea
        .cheapest(from.unwrap(), 0, to.unwrap(), 1, f32::INFINITY)
        .unwrap();
    assert_eq!(way.len(), 3, "{way:?}");
    assert_line(
        sea.route(&coasts(&shapes), pa, pb, f32::INFINITY),
        &[a, corner, b],
    );
}

/// Both straights set out from the same cell: they meet where they cross, the shortest way.
#[test]
fn straights_from_one_cell_meet() {
    // `b` is a corner of its island, its gate facing south-west onto `a`'s straight 42 m out.
    let s = 42.0 * FRAC_1_SQRT_2;
    let (a, b) = ([-100.0, 1.7], [-58.0 + s, 1.7 - s]);
    let shapes = [square([-300.0, -20.0]), square([b[0], b[1] - 200.0])];
    let (pa, pb) = ((0, a, [1.0, 0.0]), (1, b, [-FRAC_1_SQRT_2, FRAC_1_SQRT_2]));
    let mut sea = Sea::new(&shapes);
    let from = sea.out(&coasts(&shapes), pa);
    assert!(from.is_some());
    assert_eq!(from, sea.out(&coasts(&shapes), pb));
    assert_line(
        sea.route(&coasts(&shapes), pa, pb, f32::INFINITY),
        &[a, [-58.0, 1.7], b],
    );
}

/// The turns at the corners of `p`, radians.
fn turns(p: &[[f32; 2]]) -> Vec<f32> {
    (p.windows(3))
        .map(|w| {
            let u = [w[1][0] - w[0][0], w[1][1] - w[0][1]];
            let v = [w[2][0] - w[1][0], w[2][1] - w[1][1]];
            let cos = (u[0] * v[0] + u[1] * v[1]) / (u[0].hypot(u[1]) * v[0].hypot(v[1]));
            cos.clamp(-1.0, 1.0).acos()
        })
        .collect()
}

/// The other island lies beside or behind the gate: the way goes out and round, never turning
/// more than 45° at a corner, the gates' straights included.
#[test]
fn seaway_turns_at_most_45() {
    let a = [200.0, 100.0];
    // Up beside `a`'s straight, its gate facing down onto it; behind `a`'s island, facing it.
    let cases = [
        ([242.0, -400.0], [0.0, 1.0], [142.0, -600.0]),
        ([-300.0, 100.0], [1.0, 0.0], [-500.0, 0.0]),
    ];
    for (b, db, lo) in cases {
        let shapes = [square([0.0, 0.0]), square(lo)];
        let (pa, pb) = ((0, a, [1.0, 0.0]), (1, b, db));
        let way = Sea::new(&shapes).route(&coasts(&shapes), pa, pb, f32::INFINITY);
        let way = way.expect("a way");
        assert_eq!((way[0], way[way.len() - 1]), (a, b));
        let mut line = vec![[a[0] - 10.0, a[1]]];
        line.extend_from_slice(&way);
        line.push([b[0] - 10.0 * db[0], b[1] - 10.0 * db[1]]);
        for t in turns(&line) {
            assert!(t <= FRAC_PI_4 + 1e-3, "{}°: {way:?}", t.to_degrees());
        }
    }
}

/// A way that would cost more than the bound is not searched for: round the island behind the
/// gate is some 750 m and six turns.
#[test]
fn seaway_gives_up_past_its_bound() {
    let (a, b) = ([200.0, 100.0], [-300.0, 100.0]);
    let shapes = [square([0.0, 0.0]), square([-500.0, 0.0])];
    let (pa, pb) = ((0, a, [1.0, 0.0]), (1, b, [1.0, 0.0]));
    let mut sea = Sea::new(&shapes);
    assert!(sea.route(&coasts(&shapes), pa, pb, 600.0).is_none());
    assert!(sea.route(&coasts(&shapes), pa, pb, 3000.0).is_some());
}
