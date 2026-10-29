use super::*;
use std::f32::consts::FRAC_PI_4;

/// The turn at every inner vertex (every vertex of a closed line), radians.
fn turns(line: &[[f32; 2]]) -> Vec<f32> {
    let closed = line.len() > 2 && line[0] == line[line.len() - 1];
    let pts = if closed {
        &line[..line.len() - 1]
    } else {
        line
    };
    let n = pts.len();
    let at = |i: usize| pts[i % n];
    let inner = if closed { 0..n } else { 1..n - 1 };
    inner
        .map(|i| {
            let (a, b, c) = (at(i + n - 1), at(i), at(i + 1));
            let (u, v) = ([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]);
            let cos = (u[0] * v[0] + u[1] * v[1]) / (u[0].hypot(u[1]) * v[0].hypot(v[1]));
            cos.clamp(-1.0, 1.0).acos()
        })
        .collect()
}

fn octilinear(a: [f32; 2], b: [f32; 2]) -> bool {
    let k = (b[1] - a[1]).atan2(b[0] - a[0]) / FRAC_PI_4;
    (k - k.round()).abs() * FRAC_PI_4 < 1e-3
}

/// Turns of 45° at most, octilinear pieces of `MIN` or more.
fn assert_clean(line: &[[f32; 2]]) {
    let t = turns(line);
    assert!(t.iter().all(|&t| t <= FRAC_PI_4 + 1e-3), "{t:?} {line:?}");
    for w in line.windows(2) {
        assert!(octilinear(w[0], w[1]), "{w:?}");
        assert!(apart(w[0], w[1]) >= MIN - 1e-3, "{w:?} in {line:?}");
    }
}

#[test]
fn a_right_angle_becomes_two_turns_of_45() {
    let line = chamfer(&[[0.0, 0.0], [100.0, 0.0], [100.0, 100.0]]);
    assert_clean(&line);
    assert_eq!(line.len(), 4);
    assert_eq!((line[0], line[3]), ([0.0, 0.0], [100.0, 100.0]));
    // The cut runs inside the corner, 30 m long.
    assert!((apart(line[1], line[2]) - TARGET).abs() <= 1e-3);
    assert!(line[1][1] == 0.0 && line[2][0] == 100.0, "{line:?}");
}

#[test]
fn a_turn_of_135_becomes_three_turns_of_45() {
    let line = chamfer(&[[0.0, 0.0], [100.0, 0.0], [0.0, 100.0]]);
    assert_clean(&line);
    assert_eq!(turns(&line).len(), 3, "{line:?}");
}

#[test]
fn short_legs_keep_4_m() {
    assert_clean(&chamfer(&[
        [0.0, 0.0],
        [20.0, 0.0],
        [20.0, 12.0],
        [40.0, 12.0],
    ]));
    assert_clean(&chamfer(&[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]]));
}

#[test]
fn a_short_jog_becomes_one_diagonal() {
    let line = chamfer(&[[0.0, 0.0], [30.0, 0.0], [30.0, 2.0], [60.0, 2.0]]);
    let t = turns(&line);
    assert!(t.iter().all(|&t| t <= FRAC_PI_4 + 1e-3), "{line:?}");
    assert_eq!(line.len(), 4, "{line:?}");
}

#[test]
fn diagonal_legs_meet_at_a_straight_cut() {
    let line = chamfer(&[[0.0, 50.0], [50.0, 0.0], [100.0, 50.0]]);
    assert_clean(&line);
    assert_eq!(line[1][1], line[2][1], "{line:?}");
}

#[test]
fn a_closed_square_is_cut_at_every_corner() {
    let sq = [
        [0.0, 0.0],
        [100.0, 0.0],
        [100.0, 100.0],
        [0.0, 100.0],
        [0.0, 0.0],
    ];
    let line = chamfer(&sq);
    assert_clean(&line);
    assert_eq!(line.first(), line.last());
    assert_eq!(line.len(), 9, "{line:?}");
}

#[test]
fn lines_sharing_a_stretch_share_its_cut() {
    // Two lines merge at (50, 0) and turn together at (100, 0).
    let a = chamfer(&[[0.0, -50.0], [50.0, 0.0], [100.0, 0.0], [100.0, 100.0]]);
    let b = chamfer(&[[0.0, 0.0], [50.0, 0.0], [100.0, 0.0], [100.0, 100.0]]);
    assert_eq!(a[a.len() - 3..], b[b.len() - 3..]);
}

#[test]
fn gentle_lines_stay_as_they_are() {
    let line = [[0.0, 0.0], [50.0, 0.0], [80.0, 30.0], [80.0, 90.0]];
    assert_eq!(chamfer(&line), line.to_vec());
}

#[test]
fn a_line_that_doubles_back_goes_on_from_before() {
    // A gate's route that starts behind its junction, then turns off.
    let line = chamfer(&[[0.0, 0.0], [90.0, 0.0], [80.0, 0.0], [80.0, -60.0]]);
    assert_clean(&line);
    assert_eq!(line[0], [0.0, 0.0]);
    assert!(line[1][0] < 80.0 && line[1][1] == 0.0, "{line:?}");
}
