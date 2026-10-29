//! The overpasses of the test islands (highways, the ring, ramps) turn at most 45°.

use super::island;
use super::tests::all;
use crate::city::graph::Edge;
use crate::city::lattice::UNIT;
use crate::city::map::Island;
use crate::city::plan::{Folder, IslandInput};
use crate::city::runs::SPECK;
use crate::city::test_sets::{eight, five, five_real, four, four_real, three, three_real};
use std::f32::consts::FRAC_PI_4;

fn root(up: &mut [usize], mut i: usize) -> usize {
    while up[i] != i {
        up[i] = up[up[i]];
        i = up[i];
    }
    i
}

/// The points where an overpass edge has no other overpass edge to go on by at most 45°: it
/// can only leave by a sharper turn. A node with one overpass edge is an end; a crossing has a
/// straight way on for each edge. The ends of an overpass piece under `SPECK` count as one
/// node, so a square corner does not hide behind a jog of the lattice; a gate goes on over its
/// bridge.
fn sharp_turns(island: &Island) -> Vec<[f32; 2]> {
    let ends = |e: &Edge| (island.nodes[e.a as usize], island.nodes[e.b as usize]);
    let len = |e: &Edge| {
        let (a, b) = ends(e);
        (b[0] - a[0]).hypot(b[1] - a[1])
    };
    let overpasses: Vec<&Edge> = island.edges.iter().filter(|e| e.class.overpass()).collect();
    let mut up: Vec<usize> = (0..island.nodes.len()).collect();
    for e in overpasses.iter().filter(|e| len(e) < SPECK) {
        let (a, b) = (root(&mut up, e.a as usize), root(&mut up, e.b as usize));
        up[a.max(b)] = a.min(b);
    }
    let mut out: Vec<Vec<[f32; 2]>> = vec![Vec::new(); island.nodes.len()];
    for e in &overpasses {
        let (ra, rb) = (root(&mut up, e.a as usize), root(&mut up, e.b as usize));
        if ra == rb {
            continue;
        }
        let ((a, b), l) = (ends(e), len(e));
        let d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        out[ra].push(d);
        out[rb].push([-d[0], -d[1]]);
    }
    // A gate's road goes on over its bridge.
    for g in &island.gates {
        out[root(&mut up, g.node as usize)].push(g.dir);
    }
    // In along `-u`, out along `v`: the turn is 45° or less when `u · v <= -cos 45°`.
    let smooth = |u: [f32; 2], v: [f32; 2]| u[0] * v[0] + u[1] * v[1] <= -FRAC_PI_4.cos() + 1e-3;
    let stuck = |ds: &[[f32; 2]]| {
        let on = |i: usize| (ds.iter().enumerate()).any(|(j, &v)| i != j && smooth(ds[i], v));
        ds.len() > 1 && (0..ds.len()).any(|i| !on(i))
    };
    (out.iter().enumerate())
        .filter(|(_, ds)| stuck(ds))
        .map(|(n, _)| island.nodes[n])
        .collect()
}

#[test]
fn highways_turn_at_most_45() {
    // The town and the island at 45° to its canal have a canal each.
    for (k, (island, _)) in all().iter().enumerate() {
        let sharp = sharp_turns(island);
        assert!(sharp.is_empty(), "island {k}: sharp turns at {sharp:?}");
    }
    // And the archipelagos the bridges are tested on.
    let sets = [
        three(),
        four(),
        five(),
        three_real(),
        four_real(),
        five_real(),
        eight(),
    ];
    for (s, set) in sets.iter().enumerate() {
        for (k, island) in set.iter().enumerate() {
            let sharp = sharp_turns(island);
            assert!(
                sharp.is_empty(),
                "set {s} island {k}: sharp turns at {sharp:?}"
            );
        }
    }
}

#[test]
fn chamfer_keeps_octilinear_and_lattice() {
    for (island, _) in all() {
        let overpasses = island.edges.iter().filter(|e| e.class.overpass());
        let o = island.nodes[0];
        // The map is shifted as a whole: the nodes keep their lattice relative to each other.
        let on_lattice = |p: [f32; 2]| {
            let off = |v: f32| ((v * UNIT).round() - v * UNIT).abs() < 0.05;
            off(p[0] - o[0]) && off(p[1] - o[1])
        };
        for e in overpasses {
            let (a, b) = (island.nodes[e.a as usize], island.nodes[e.b as usize]);
            let k = (b[1] - a[1]).atan2(b[0] - a[0]) / FRAC_PI_4;
            assert!(
                (k - k.round()).abs() * FRAC_PI_4 < 1e-3,
                "{e:?}: {a:?} {b:?}"
            );
            assert!(on_lattice(a) && on_lattice(b), "{e:?}: {a:?} {b:?}");
        }
    }
}

#[test]
fn small_islands_keep_their_gates_and_turn_at_most_45() {
    // On an island of a few folders the core's ring runs along the shore, past the gates.
    for seed in 0..12 {
        let size = 20_000;
        let child = Folder {
            id: 2,
            size,
            children: Vec::new(),
        };
        let root = Folder {
            id: 1,
            size,
            children: vec![child],
        };
        let neighbours = vec![0.5, 2.6];
        let island = island(&IslandInput {
            root,
            free: size,
            neighbours,
            seed,
        });
        assert_eq!(island.gates.len(), 2, "{seed}");
        let sharp = sharp_turns(&island);
        assert!(sharp.is_empty(), "{seed}: sharp turns at {sharp:?}");
    }
}
