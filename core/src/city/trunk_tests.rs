use super::*;
use crate::city::archipelago::tests::{len, refs, sub};
use crate::city::test_sets::{eight, five, random, six};
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
    let shared: usize = [five(), six(), eight()]
        .iter()
        .map(|set| trunk_runs(&laid(set), true).0)
        .sum();
    assert!(
        shared > 0,
        "no bridges share a trunk: the test proves nothing"
    );
}

/// The runs of `all` that two bridges take as one, and the pairs of runs side by side that are
/// not one: none where `strict` (see [`bridges_side_by_side_share_one_trunk`]), else each on
/// its own deck.
fn trunk_runs(all: &[Bridge], strict: bool) -> (usize, usize) {
    let (mut shared, mut apart) = (0, 0);
    {
        for (i, x) in all.iter().enumerate() {
            for y in &all[i + 1..] {
                for (r, (s, gs)) in runs(x).enumerate() {
                    for (q, (t, gt)) in runs(y).enumerate() {
                        let fork = gs
                            && gt
                            && [s[0], s[1]].iter().any(|&p| same(p, t[0]) || same(p, t[1]));
                        let Some((aside, overlap)) = alongside(s, t) else {
                            continue;
                        };
                        if aside >= NEAR as f32 || overlap < NEAR as f32 || fork {
                            continue;
                        }
                        let msg = format!("{aside} m apart over {overlap} m: {x:?} {y:?}");
                        if !one(s, t) && !strict {
                            assert_ne!(x.levels[r], y.levels[q], "{msg}");
                            apart += 1;
                            continue;
                        }
                        assert!(one(s, t), "{msg}");
                        assert_eq!(x.levels[r], y.levels[q], "a trunk is one deck: {msg}");
                        shared += 1;
                    }
                }
            }
        }
    }
    (shared, apart)
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

fn octilinear(p: &[[f32; 2]]) -> bool {
    p.windows(2).all(|w| {
        let d = sub(w[1], w[0]);
        let k = d[1].atan2(d[0]) / std::f32::consts::FRAC_PI_4;
        (k - k.round()).abs() * std::f32::consts::FRAC_PI_4 < 1e-3
    })
}

/// A fork 0.1 m into a run, 9 mm off its line: the piece it splits off lies along the run, and
/// both bridges take the same point.
#[test]
fn a_short_piece_at_a_fork_keeps_its_direction() {
    let mut p = vec![[-50.0, 50.0], [0.0, 0.0], [100.0, 0.0], [150.0, 50.0]];
    let mut q = vec![[-49.9, -50.0], [0.1, 0.009], [60.0, 0.009], [110.0, 50.0]];
    share(&mut p, &mut q);
    assert!(octilinear(&p) && octilinear(&q), "{p:?} {q:?}");
    assert_eq!(p[2], q[1], "{p:?} {q:?}");
}

/// A point of one bridge within a centimetre of a point of another, on one line, becomes it.
#[test]
fn points_a_centimetre_apart_become_one() {
    let mut p = vec![[-50.0, 50.0], [0.0, 0.0], [100.0, 0.0], [150.0, 50.0]];
    let mut q = vec![[-50.0, -50.0], [0.004, 0.003], [60.0, 0.003], [110.0, 50.0]];
    share(&mut p, &mut q);
    assert_eq!(q[1], p[1], "{p:?} {q:?}");
    assert!(octilinear(&q), "{q:?}");
}

/// Three bridges along one line, each over another stretch of it, end up with the same points
/// there whichever pair is shared first.
#[test]
fn three_bridges_on_one_line_share_every_point() {
    let line = |from: f32, to: f32| {
        vec![
            [from - 50.0, 50.0],
            [from, 0.0],
            [to, 0.0],
            [to + 50.0, 50.0],
        ]
    };
    let mut lines = vec![line(0.0, 300.0), line(100.0, 400.0), line(200.0, 500.0)];
    join(&mut lines, &[(30.0, 30.0); 3], |_, _| true);
    for x in &lines {
        for y in &lines {
            for w in x.windows(2) {
                for v in y {
                    let inside = v[1].abs() < 0.01 && w[0][1].abs() < 0.01 && w[1][1].abs() < 0.01;
                    let (lo, hi) = (w[0][0].min(w[1][0]), w[0][0].max(w[1][0]));
                    assert!(
                        !(inside && v[0] > lo + 0.01 && v[0] < hi - 0.01),
                        "{v:?} in {w:?}: {lines:?}"
                    );
                }
            }
        }
    }
}

/// Random archipelagos (20 seeds, 4 to 8 islands of random sizes): every pair with gates
/// towards each other bridged gate to gate, no corner over 45° (nor where a bridge leaves its gates' straights), and runs side by
/// side one trunk on one deck. Slow in a debug build: run with `--release -- --ignored`.
#[test]
#[ignore]
fn random_archipelagos_share_their_trunks() {
    let (mut shared, mut unjoined) = (0, 0);
    for seed in 0..20 {
        let set = random(seed);
        let at = place(&refs(&set));
        let all = bridges(&refs(&set), &at);
        let n = set.len();
        let mut pairs: Vec<_> = all.iter().map(|b| (b.a.0, b.b.0)).collect();
        pairs.sort_unstable();
        // Every pair whose islands have gates facing each other (an island may have none).
        let faced =
            |i: usize, j: usize| set[i].facing(j - 1).is_some() && set[j].facing(i).is_some();
        let want: Vec<_> = (0..n)
            .flat_map(|i| (i + 1..n).map(move |j| (i, j)))
            .filter(|&(i, j)| faced(i, j))
            .collect();
        assert_eq!(pairs, want, "seed {seed}");
        for b in &all {
            let dir =
                |(k, node): (usize, u32)| set[k].gates.iter().find(|g| g.node == node).unwrap().dir;
            let (p, m) = (&b.points, b.points.len());
            let back = |q: [f32; 2], d: [f32; 2]| [q[0] - 10.0 * d[0], q[1] - 10.0 * d[1]];
            let mut line = vec![back(p[0], dir(b.a))];
            line.extend_from_slice(p);
            line.push(back(p[m - 1], dir(b.b)));
            assert!(!crate::city::bends::sharp(&line), "seed {seed}: {b:?}");
            assert!(octilinear(p), "seed {seed}: {b:?}");
        }
        let (on_trunk, beside) = trunk_runs(&all, false);
        (shared, unjoined) = (shared + on_trunk, unjoined + beside);
    }
    eprintln!("20 random archipelagos: {shared} runs shared, {unjoined} side by side apart");
    // Where a straight out of a gate holds a run off the line beside it, the two stay apart,
    // on different decks: rare.
    assert!(
        unjoined * 100 <= shared,
        "{unjoined} runs side by side apart, {shared} shared"
    );
}
