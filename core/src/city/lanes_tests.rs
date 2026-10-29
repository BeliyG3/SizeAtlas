use super::*;

fn close(p: [f32; 2], q: [f32; 2]) -> bool {
    (p[0] - q[0]).hypot(p[1] - q[1]) < 1e-3
}

/// A run 6 m beside a straight out of a gate moves onto its line, its corners sliding along the
/// runs either side; the runs keep their directions and the straight stays.
#[test]
fn align_moves_a_run_onto_the_line_beside() {
    let gate = vec![[0.0, 0.0], [400.0, 0.0]];
    let p = vec![
        [0.0, 100.0],
        [0.0, 70.0],
        [64.0, 6.0],
        [300.0, 6.0],
        [340.0, 46.0],
    ];
    let mut lines = vec![gate.clone(), p.clone()];
    assert!(align(&mut lines, &[(30.0, 30.0); 2], |_, _| true));
    assert_eq!(lines[0], gate);
    let moved = &lines[1];
    assert_eq!(moved.len(), p.len());
    assert!(
        close(moved[2], [70.0, 0.0]) && close(moved[3], [294.0, 0.0]),
        "{moved:?}"
    );
    for (w, v) in moved.windows(2).zip(p.windows(2)) {
        let (a, b) = (sub(f(w[1]), f(w[0])), sub(f(v[1]), f(v[0])));
        assert!(
            cross(a, b).abs() / (a[0].hypot(a[1]) * b[0].hypot(b[1])) < 1e-4,
            "{moved:?}"
        );
    }
    let mut kept = vec![gate, p.clone()];
    assert!(!align(&mut kept, &[(30.0, 30.0); 2], |_, _| false));
    assert_eq!(kept[1], p);
}

/// A run that would leave its neighbour shorter than a run can be carries that neighbour along
/// the run beyond it.
#[test]
fn a_short_neighbour_is_carried_along() {
    let gate = vec![[0.0, 0.0], [400.0, 0.0]];
    // North, a 4 m stub north-east, east 10 m off the line (north of it), south-east.
    let s = 4.0 * std::f32::consts::FRAC_1_SQRT_2;
    let p = vec![
        [0.0, 100.0],
        [0.0, -10.0 + s],
        [s, -10.0],
        [300.0, -10.0],
        [340.0, 30.0],
    ];
    let mut lines = vec![gate, p];
    assert!(align(&mut lines, &[(30.0, 30.0); 2], |_, _| true));
    let moved = &lines[1];
    assert!(
        close(moved[1], [0.0, s]) && close(moved[2], [s, 0.0]),
        "{moved:?}"
    );
    assert!(close(moved[3], [310.0, 0.0]), "{moved:?}");
}
