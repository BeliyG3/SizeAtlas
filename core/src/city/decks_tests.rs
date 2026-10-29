use super::*;
use crate::city::archipelago::tests::{crossing, point_segment, refs};
use crate::city::test_sets::{eight, five, six};
use crate::city::{Bridge, Island, bridges, place};

fn laid(set: &[Island]) -> Vec<Bridge> {
    bridges(&refs(set), &place(&refs(set)))
}

fn same(p: [f32; 2], q: [f32; 2]) -> bool {
    (p[0] - q[0]).hypot(p[1] - q[1]) <= 0.01
}

/// The least distance between runs `s` and `t`, 0 where they cross.
fn apart(s: &[[f32; 2]], t: &[[f32; 2]]) -> f32 {
    if crossing(s[0], s[1], t[0], t[1]) {
        return 0.0;
    }
    let ends = [(s[0], t), (s[1], t), (t[0], s), (t[1], s)];
    (ends.iter()).fold(f32::INFINITY, |m, (p, r)| {
        m.min(point_segment(*p, r[0], r[1]))
    })
}

/// Each run of every bridge has its deck: a run several bridges share is one deck in each, and
/// runs of different bridges that cross, or pass within a deck and a margin of each other but
/// where they meet end to end, stand on different decks; but two runs that one bridge takes may
/// share one (a bridge does not pass over itself at its turns, nor along a straight a fork
/// splits).
#[test]
fn every_run_has_its_deck() {
    let (mut crossings, mut shared) = (0, 0);
    for set in [five(), six(), eight()] {
        let all = laid(set);
        for b in &all {
            assert_eq!(b.levels.len(), b.points.len() - 1, "{b:?}");
        }
        let top = all
            .iter()
            .flat_map(|b| b.levels.iter())
            .max()
            .copied()
            .unwrap_or(0);
        eprintln!("{} islands: decks up to level {top}", set.len());
        for (i, x) in all.iter().enumerate() {
            for y in &all[i + 1..] {
                for (r, s) in x.points.windows(2).enumerate() {
                    for (q, t) in y.points.windows(2).enumerate() {
                        let (lx, ly) = (x.levels[r], y.levels[q]);
                        let one = (same(s[0], t[0]) && same(s[1], t[1]))
                            || (same(s[0], t[1]) && same(s[1], t[0]));
                        let meet = s.iter().any(|&p| point_segment(p, t[0], t[1]) <= 0.01)
                            || t.iter().any(|&p| point_segment(p, s[0], s[1]) <= 0.01);
                        // Two runs of one bridge (that may share them with others) may.
                        let on = |run: &[[f32; 2]], b: &Bridge| {
                            (b.points.windows(2)).any(|w| {
                                (same(run[0], w[0]) && same(run[1], w[1]))
                                    || (same(run[0], w[1]) && same(run[1], w[0]))
                            })
                        };
                        if one {
                            shared += 1;
                            assert_eq!(lx, ly, "a trunk is one deck: {x:?} {y:?}");
                        } else if !meet
                            && !all.iter().any(|b| on(s, b) && on(t, b))
                            && apart(s, t) < NEAR as f32
                        {
                            crossings += usize::from(apart(s, t) == 0.0);
                            assert_ne!(lx, ly, "{s:?} {t:?}: {x:?} {y:?}");
                        }
                    }
                }
            }
        }
    }
    assert!(
        crossings > 0 && shared > 0,
        "{crossings} crossings, {shared} shared runs"
    );
}

/// A bridge alone keeps level 0 all along; one that crosses an earlier one rises over it there
/// only.
#[test]
fn decks_rise_only_where_they_cross() {
    let lone = vec![vec![[0.0, 0.0], [100.0, 0.0], [200.0, 100.0]]];
    assert_eq!(decks(&lone), vec![vec![0, 0]]);
    let two = vec![
        vec![[0.0, 0.0], [400.0, 0.0]],
        vec![
            [200.0, -300.0],
            [200.0, -100.0],
            [250.0, -50.0],
            [250.0, 250.0],
            [300.0, 300.0],
        ],
    ];
    assert_eq!(decks(&two), vec![vec![0], vec![0, 0, 1, 0]]);
}
