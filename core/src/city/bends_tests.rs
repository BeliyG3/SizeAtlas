use super::*;
use std::f32::consts::FRAC_1_SQRT_2;

fn close(p: [f32; 2], q: [f32; 2]) -> bool {
    (p[0] - q[0]).hypot(p[1] - q[1]) < 1e-3
}

/// East, 6 m south-east, south: the short run between the two turns grows to 30 m, the ends
/// stay put and every run keeps its direction.
#[test]
fn ease_draws_two_turns_apart() {
    let s = 6.0 * FRAC_1_SQRT_2;
    let line = vec![
        [0.0, 0.0],
        [100.0, 0.0],
        [100.0 + s, s],
        [100.0 + s, 100.0 + s],
    ];
    let eased = ease(line.clone(), (30.0, 30.0), |_| true);
    assert_eq!(eased.len(), 4);
    assert!(
        close(eased[0], line[0]) && close(eased[3], line[3]),
        "{eased:?}"
    );
    let x = (30.0 - 6.0) * FRAC_1_SQRT_2;
    assert!(close(eased[1], [100.0 - x, 0.0]), "{eased:?}");
    assert!(close(eased[2], [100.0 + s, s + x]), "{eased:?}");
    assert!((length(&eased[1..3]) - 30.0).abs() < 1e-3, "{eased:?}");
    assert!(!sharp(&eased));
}

/// Turns the other way round (a jog) and runs nothing lets move stay as they are.
#[test]
fn ease_leaves_jogs_and_blocked_runs() {
    let s = 6.0 * FRAC_1_SQRT_2;
    let jog = vec![[0.0, 0.0], [100.0, 0.0], [100.0 + s, s], [200.0, s]];
    assert_eq!(ease(jog.clone(), (30.0, 30.0), |_| true), jog);
    let turn = vec![[0.0, 0.0], [100.0, 0.0], [100.0 + s, s], [100.0 + s, 100.0]];
    assert_eq!(ease(turn.clone(), (30.0, 30.0), |_| false), turn);
}

/// A run beside a gate keeps the gate's straight: it gives at most what it has past `least`.
#[test]
fn ease_keeps_the_gate_straights() {
    let s = 6.0 * FRAC_1_SQRT_2;
    let line = vec![[0.0, 0.0], [40.0, 0.0], [40.0 + s, s], [40.0 + s, 100.0]];
    let eased = ease(line, (30.0, 30.0), |_| true);
    assert!(close(eased[1], [30.0, 0.0]), "{eased:?}");
}

#[test]
fn cost_counts_the_turns() {
    let line = [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0]];
    assert!((cost(&line) - (200.0 + 2.0 * BEND)).abs() < 1e-3);
    assert!(sharp(&line));
}
