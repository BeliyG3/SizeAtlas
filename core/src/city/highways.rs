//! Highways from the shore to the core, the ring round the core, and the gates towards the
//! neighbouring islands with the ramps of their junctions.

use super::chamfer::chamfer;
use super::gates::{gate, ramps};
use super::grid::Grid;
use super::net::{Line, Net};
use super::ring::ring;
use std::f32::consts::{PI, TAU};

/// The highways start out `k · 60° + TURN` from the core.
const BASES: usize = 6;
const TURN: f32 = 0.3;

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Highways {
    /// From the shore to the core seed. A gate's line starts with its straight: the shore end,
    /// then the junction. Highways that merge share their points from there on.
    pub lines: Vec<Line>,
    /// The core's outline, closed.
    pub ring: Vec<Line>,
    /// Per gate: its line, its outward direction (a multiple of 45°) and the neighbours
    /// (indices into `neighbours`) it faces.
    pub gates: Vec<(usize, [f32; 2], Vec<usize>)>,
    /// From a junction to other highways; the junction's way onto its own highway is that
    /// highway itself.
    pub ramps: Vec<Line>,
}

/// The highways of the `land` split into districts `dist` (the core is district 0, its seed at
/// `core`, metres), with gates towards the islands in the directions `neighbours` (radians).
pub(crate) fn highways(
    land: &Grid<bool>,
    dist: &Grid<i32>,
    core: [f32; 2],
    neighbours: &[f32],
) -> Highways {
    let Some(net) = Net::new(land, dist, core) else {
        return Highways::default();
    };
    let mut out = Highways::default();
    let mut starts = Vec::with_capacity(BASES);
    let mut shores: Vec<Option<[f32; 2]>> = Vec::with_capacity(BASES);
    for (k, (a, faced)) in turn(neighbours).into_iter().enumerate() {
        let taken: Vec<_> = (shores.iter().zip(&starts))
            .filter_map(|(s, &(j, _))| s.map(|s| (s, j)))
            .collect();
        let found = (!faced.is_empty())
            .then(|| gate(land, &net, core, a, &taken))
            .flatten();
        let start = match found {
            Some((shore, junction, outward)) => {
                out.gates.push((k, outward, faced));
                shores.push(Some(shore));
                junction
            }
            None => {
                shores.push(None);
                net.centre(net.farthest(core, [a.cos(), a.sin()]))
            }
        };
        // A gate's junction, like a farthest cell's centre, lies in a cell the core reaches.
        starts.push((start, net.cell(start).unwrap_or_default()));
    }
    for (route, shore) in net.routes(&starts, core).into_iter().zip(shores) {
        let line: Line = shore.into_iter().chain(route).collect();
        out.lines.push(chamfer(&line));
    }
    for (g, ..) in &out.gates {
        let more = ramps(land, &net, &out.lines, *g);
        out.ramps.extend(more.iter().map(|r| chamfer(r)));
    }
    out.ring.extend(ring(dist, core).map(|r| chamfer(&r)));
    out
}

/// The six highway directions (radians) and the neighbours each faces: every neighbour turns
/// its nearest base direction onto itself (several sharing one turn it onto their mean).
fn turn(neighbours: &[f32]) -> Vec<(f32, Vec<usize>)> {
    let base = |k: usize| k as f32 * TAU / BASES as f32 + TURN;
    let gap = |a: f32, b: f32| ((a - b + PI).rem_euclid(TAU) - PI).abs();
    let mut faced = vec![Vec::new(); BASES];
    for (j, &a) in neighbours.iter().enumerate().filter(|(_, a)| a.is_finite()) {
        let k = (0..BASES)
            .min_by(|&p, &q| gap(a, base(p)).total_cmp(&gap(a, base(q))))
            .unwrap_or(0);
        faced[k].push(j);
    }
    faced
        .into_iter()
        .enumerate()
        .map(|(k, f)| {
            if f.is_empty() {
                return (base(k), f);
            }
            let (s, c) = f.iter().fold((0.0f32, 0.0f32), |(s, c), &j| {
                (s + neighbours[j].sin(), c + neighbours[j].cos())
            });
            (s.atan2(c), f)
        })
        .collect()
}

#[cfg(test)]
#[path = "highways_tests.rs"]
mod tests;
