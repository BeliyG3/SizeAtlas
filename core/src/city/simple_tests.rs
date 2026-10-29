use super::*;
use crate::city::bends::sharp;
use std::f32::consts::FRAC_PI_4;

fn runs(p: &[[f32; 2]]) -> Vec<(f32, f32)> {
    (p.windows(2))
        .map(|w| {
            let d = [w[1][0] - w[0][0], w[1][1] - w[0][1]];
            (d[0].hypot(d[1]), d[1].atan2(d[0]))
        })
        .collect()
}

/// Gates across a strait, 0.09 m off line: no single run makes that up, the jog does.
#[test]
fn facing_gates_a_little_off_line_jog() {
    let (a, b) = ([27.75, -220.5], [27.84, -335.0]);
    let (da, db) = ([0.0, -1.0], [0.0, 1.0]);
    let ok = |_: &[[f32; 2]]| true;
    assert_eq!(route(a, da, b, db, (30.0, 30.0), ok), None);
    let p = jog(a, da, b, db, (30.0, 30.0), ok).expect("a jog");
    assert_eq!((p[0], p[p.len() - 1]), (a, b));
    let r = runs(&p);
    assert!(
        r[0].0 >= 30.0 - 1e-3 && r[r.len() - 1].0 >= 30.0 - 1e-3,
        "{r:?}"
    );
    for (l, angle) in r {
        let k = angle / FRAC_PI_4;
        assert!(l >= SHORT as f32 - 1e-3, "{p:?}");
        assert!((k - k.round()).abs() * FRAC_PI_4 < 1e-3, "{p:?}");
    }
    assert!(!sharp(&p), "{p:?}");
}

/// A jog only where the gates face each other and a diagonal cannot make up the offset.
#[test]
fn jog_only_for_small_offsets_of_facing_gates() {
    let ok = |_: &[[f32; 2]]| true;
    let (a, da) = ([0.0, 0.0], [1.0, 0.0]);
    assert!(jog(a, da, [200.0, 3.0], [-1.0, 0.0], (30.0, 30.0), ok).is_none());
    assert!(jog(a, da, [200.0, 1.0], [0.0, 1.0], (30.0, 30.0), ok).is_none());
    assert!(jog(a, da, [70.0, 1.0], [-1.0, 0.0], (30.0, 30.0), ok).is_none());
    assert!(jog(a, da, [200.0, 1.0], [-1.0, 0.0], (30.0, 30.0), |_| false).is_none());
}
