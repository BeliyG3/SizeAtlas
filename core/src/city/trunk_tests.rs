use super::*;
use crate::city::archipelago::tests::{len, refs, sub};
use crate::city::test_sets::{eight, five, six};
use crate::city::{Bridge, Island, bridges, place};

/// How runs `s` and `t` lie: if along one direction (either way), how far `t`'s line lies off
/// `s`'s and how long a stretch of `s` they share side by side.
fn alongside(s: [[f32; 2]; 2], t: [[f32; 2]; 2]) -> Option<(f32, f32)> {
    let (u, v) = (sub(s[1], s[0]), sub(t[1], t[0]));
    let (lu, lv) = (len(u), len(v));
    let e = [u[0] / lu, u[1] / lu];
    if (e[0] * v[1] - e[1] * v[0]).abs() / lv > 1e-3 {
        return None;
    }
    let rel = |p: [f32; 2]| sub(p, s[0]);
    let aside = (e[0] * rel(t[0])[1] - e[1] * rel(t[0])[0]).abs();
    let along = |p: [f32; 2]| e[0] * rel(p)[0] + e[1] * rel(p)[1];
    let (a0, a1) = (along(t[0]), along(t[1]));
    let overlap = lu.min(a0.max(a1)) - a0.min(a1).max(0.0);
    Some((aside, overlap))
}

fn same(p: [f32; 2], q: [f32; 2]) -> bool {
    len(sub(p, q)) <= 0.01
}

/// Whether runs `s` and `t` are one: the same two ends, either way round.
fn one(s: [[f32; 2]; 2], t: [[f32; 2]; 2]) -> bool {
    (same(s[0], t[0]) && same(s[1], t[1])) || (same(s[0], t[1]) && same(s[1], t[0]))
}

/// The runs of `b`, each with whether it is a straight out of a gate.
fn runs(b: &Bridge) -> impl Iterator<Item = ([[f32; 2]; 2], bool)> + '_ {
    let n = b.points.len() - 1;
    (b.points.windows(2).enumerate()).map(move |(r, w)| ([w[0], w[1]], r == 0 || r + 1 == n))
}

fn laid(set: &[Island]) -> Vec<Bridge> {
    bridges(&refs(set), &place(&refs(set)))
}

/// Of two bridges, runs side by side within a deck and a margin, for at least as long, are one
/// run (a trunk both take, on one level), but for the straights out of a gate they both leave by
/// (the frontend forks those). Two chamfers of a crossing a few metres long do not count.
#[test]
fn bridges_side_by_side_share_one_trunk() {
    let mut shared = 0;
    for set in [five(), six(), eight()] {
        let all = laid(set);
        for (i, x) in all.iter().enumerate() {
            for y in &all[i + 1..] {
                for (s, gs) in runs(x) {
                    for (t, gt) in runs(y) {
                        let fork = gs
                            && gt
                            && [s[0], s[1]].iter().any(|&p| same(p, t[0]) || same(p, t[1]));
                        let Some((aside, overlap)) = alongside(s, t) else {
                            continue;
                        };
                        if aside >= NEAR as f32 || overlap < NEAR as f32 || fork {
                            continue;
                        }
                        assert!(one(s, t), "{aside} m apart over {overlap} m: {x:?} {y:?}");
                        assert_eq!(x.level, y.level, "a trunk is one deck: {x:?} {y:?}");
                        shared += 1;
                    }
                }
            }
        }
    }
    assert!(
        shared > 0,
        "no bridges share a trunk: the test proves nothing"
    );
}

/// Two bridges along one line get each other's points there, and nowhere else.
#[test]
fn share_gives_one_line_the_same_points() {
    let mut p = vec![[0.0, 50.0], [50.0, 0.0], [300.0, 0.0], [350.0, 50.0]];
    let mut q = vec![[100.0, -50.0], [150.0, 0.0], [400.0, 0.0], [450.0, -50.0]];
    share(&mut p, &mut q);
    assert_eq!(
        p,
        vec![
            [0.0, 50.0],
            [50.0, 0.0],
            [150.0, 0.0],
            [300.0, 0.0],
            [350.0, 50.0]
        ]
    );
    assert_eq!(
        q,
        vec![
            [100.0, -50.0],
            [150.0, 0.0],
            [300.0, 0.0],
            [400.0, 0.0],
            [450.0, -50.0]
        ]
    );
}
