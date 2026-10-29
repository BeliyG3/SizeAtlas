//! The bridges between the islands of the archipelago, gate to gate: straight out, one turn
//! onto a multiple of 45°, straight in; round the islands over the open sea where that shape
//! cannot keep off them or is the longer way. No corner turns more than 45°.

use super::bends::{BEND, cost, ease, length};
use super::chart::shape;
use super::coast::{Coast, keeps_clear};
use super::gates::segments_apart;
use super::landing::clears;
use super::map::{Gate, Island};
use super::seaway::Sea;
use super::simple::{jog, route};
use super::trunk::{join, one_run, touch};

/// The way over the sea is taken where it is shorter than this share of the simple shape.
const SHORTER: f32 = 0.75;
/// Without a simple shape, the way over the sea is searched up to this many times as long as
/// the gates lie apart, and eight turns.
const DETOUR: f32 = 4.0;
/// Bridges nearer than a deck's width and a margin stand on different levels, metres.
const APART: f32 = super::trunk::NEAR as f32;

/// A bridge from gate `a` to gate `b`, each `(island, gate node)`, `a`'s island the lower; its
/// points run from `a`'s node to `b`'s in world metres. Its deck stands on `level`.
#[derive(Clone, Debug, PartialEq)]
pub struct Bridge {
    pub a: (usize, u32),
    pub b: (usize, u32),
    pub points: Vec<[f32; 2]>,
    pub level: u8,
}

/// A bridge for every pair of `islands` (moved by `offsets`, see [`super::place`]) whose gates
/// face each other, keeping `CLEAR` from every outline but on its way out of its gates (see
/// [`keeps_clear`]). Of the shortest simple path `a + s·da`, a run along one of the eight
/// directions, `b + t·db` back to `b` (`s, t` at least as far as the straights run near their
/// coasts, see [`clears`]) and the way of [`Sea::route`] it takes the one of the lower
/// [`cost`], but the sea's where that is shorter than `SHORTER` of the other; with neither,
/// none. No corner turns more than 45°, and two turns the same way are drawn apart (see
/// [`ease`]). The pairs go in a fixed order; the way over the sea of a later one is cheaper
/// along the earlier bridges. Then runs side by side are moved onto one line and given the
/// same points (see [`join`]): bridges that run together are one trunk. A trunk's bridges stand
/// on one level, the lowest none of the earlier ones any of them [`conflicts`] with takes.
pub fn bridges(islands: &[&Island], offsets: &[[f32; 2]]) -> Vec<Bridge> {
    let shapes: Vec<_> = (islands.iter().zip(offsets))
        .map(|(s, &o)| shape(s, o))
        .collect();
    if shapes.len() < 2 {
        return Vec::new();
    }
    let coasts: Vec<Coast> = shapes.iter().map(|s| Coast::new(s)).collect();
    let mut sea = Sea::new(&shapes);
    let (mut out, mut least_of) = (Vec::new(), Vec::new());
    for i in 0..shapes.len() {
        for j in i + 1..shapes.len() {
            // Neighbours are counted without the island itself.
            let (Some(ga), Some(gb)) = (islands[i].facing(j - 1), islands[j].facing(i)) else {
                continue;
            };
            let end = |k: usize, g: &Gate| {
                let n = islands[k].nodes[g.node as usize];
                [n[0] + offsets[k][0], n[1] + offsets[k][1]]
            };
            let (a, b) = (end(i, ga), end(j, gb));
            let clear = |p: &[[f32; 2]]| keeps_clear(&coasts, p, Some(i), Some(j));
            let least = (clears(&coasts[i], a, ga.dir), clears(&coasts[j], b, gb.dir));
            let simple = route(a, ga.dir, b, gb.dir, least, clear)
                .or_else(|| jog(a, ga.dir, b, gb.dir, least, clear));
            // The sea's way can only be taken where it costs less than the simple shape, or is
            // `SHORTER` of it (allowing it those turns); with none, at most `DETOUR` times
            // the way as the crow flies.
            let bound = match &simple {
                Some(p) => cost(p) / SHORTER,
                None => DETOUR * (b[0] - a[0]).hypot(b[1] - a[1]) + 8.0 * BEND,
            };
            let way = sea.route(&coasts, (i, a, ga.dir), (j, b, gb.dir), bound);
            if let Some(points) = pick(simple, way).map(|p| ease(p, least, clear)) {
                sea.mark(&points);
                least_of.push(least);
                out.push(Bridge {
                    a: (i, ga.node),
                    b: (j, gb.node),
                    points,
                    level: 0,
                });
            }
        }
    }
    let mut lines: Vec<Vec<[f32; 2]>> = out.iter().map(|b: &Bridge| b.points.clone()).collect();
    let ends: Vec<(usize, usize)> = out.iter().map(|b| (b.a.0, b.b.0)).collect();
    join(&mut lines, &least_of, |k, p| {
        keeps_clear(&coasts, p, Some(ends[k].0), Some(ends[k].1))
    });
    for (b, line) in out.iter_mut().zip(lines) {
        b.points = line;
    }
    let trunk = trunks(&out);
    let mut done = vec![false; out.len()];
    for k in 0..out.len() {
        if done[k] {
            continue;
        }
        let members: Vec<usize> = (k..out.len()).filter(|&m| trunk[m] == trunk[k]).collect();
        let taken: Vec<u8> = (0..out.len())
            .filter(|&e| done[e] && members.iter().any(|&m| conflicts(&out[e], &out[m])))
            .map(|e| out[e].level)
            .collect();
        let level = (0..u8::MAX).find(|l| !taken.contains(l)).unwrap_or(u8::MAX);
        for m in members {
            (out[m].level, done[m]) = (level, true);
        }
    }
    out
}

/// For each bridge, the first bridge of its trunk: those that share a run, but for two runs out
/// of gates (the frontend ramps those forks to the lower deck).
pub(crate) fn trunks(all: &[Bridge]) -> Vec<usize> {
    let gate = |b: &Bridge, r: usize| r == 0 || r + 2 == b.points.len();
    let shares = |x: &Bridge, y: &Bridge| {
        (0..x.points.len() - 1).any(|r| {
            (0..y.points.len() - 1).any(|q| {
                !(gate(x, r) && gate(y, q)) && one_run(&x.points[r..r + 2], &y.points[q..q + 2])
            })
        })
    };
    let mut first: Vec<usize> = (0..all.len()).collect();
    for x in 0..all.len() {
        for y in 0..x {
            if shares(&all[x], &all[y]) {
                let (a, b) = (first[x], first[y]);
                let (keep, gone) = (a.min(b), a.max(b));
                first
                    .iter_mut()
                    .filter(|f| **f == gone)
                    .for_each(|f| *f = keep);
            }
        }
    }
    first
}

/// The bridge to take of the `simple` shape and the way over the `sea` (see [`bridges`]).
fn pick(simple: Option<Vec<[f32; 2]>>, sea: Option<Vec<[f32; 2]>>) -> Option<Vec<[f32; 2]>> {
    match (simple, sea) {
        (Some(p), Some(q)) => {
            // Within a metre, they are the same way.
            let sea_wins = length(&q) < SHORTER * length(&p) || cost(&q) < cost(&p) - 1.0;
            Some(if sea_wins { q } else { p })
        }
        (p, q) => p.or(q),
    }
}

/// Whether bridges `x` and `y` cross or come within `APART`, but for runs they share and runs
/// that meet end to end (they fork or join there).
fn conflicts(x: &Bridge, y: &Bridge) -> bool {
    (0..x.points.len() - 1).any(|r| {
        (0..y.points.len() - 1).any(|q| {
            let (s, t) = (&x.points[r..r + 2], &y.points[q..q + 2]);
            !one_run(s, t) && !touch(s, t) && segments_apart(s[0], s[1], t[0], t[1]) < APART
        })
    })
}

#[cfg(test)]
#[path = "span_tests.rs"]
mod tests;
