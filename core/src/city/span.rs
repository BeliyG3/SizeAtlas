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

/// The way over the sea is taken where it is shorter than this share of the simple shape.
const SHORTER: f32 = 0.75;
/// Without a simple shape, the way over the sea is searched up to this many times as long as
/// the gates lie apart, and eight turns.
const DETOUR: f32 = 4.0;
/// Bridges nearer than a deck's width and a margin stand on different levels, metres.
const APART: f32 = 16.0 + 4.0;

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
/// [`ease`]). A bridge stands on the lowest level none of the earlier ones it [`conflicts`]
/// with takes.
pub fn bridges(islands: &[&Island], offsets: &[[f32; 2]]) -> Vec<Bridge> {
    let shapes: Vec<_> = (islands.iter().zip(offsets))
        .map(|(s, &o)| shape(s, o))
        .collect();
    if shapes.len() < 2 {
        return Vec::new();
    }
    let coasts: Vec<Coast> = shapes.iter().map(|s| Coast::new(s)).collect();
    let mut sea = Sea::new(&shapes);
    let mut out = Vec::new();
    for i in 0..shapes.len() {
        for j in i + 1..shapes.len() {
            // Neighbours are counted without the island itself.
            let (Some(ga), Some(gb)) = (facing(islands[i], j - 1), facing(islands[j], i)) else {
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
            let points = pick(simple, way).map(|p| ease(p, least, clear));
            if let Some(points) = points {
                out.push(Bridge {
                    a: (i, ga.node),
                    b: (j, gb.node),
                    points,
                    level: 0,
                });
            }
        }
    }
    for k in 0..out.len() {
        let taken: Vec<u8> = (0..k)
            .filter(|&e| conflicts(&out[e], &out[k]))
            .map(|e| out[e].level)
            .collect();
        out[k].level = (0..u8::MAX).find(|l| !taken.contains(l)).unwrap_or(u8::MAX);
    }
    out
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

/// The first gate of `island` that faces its neighbour `n`.
fn facing(island: &Island, n: usize) -> Option<&Gate> {
    (island.gates.iter()).find(|g| g.neighbours.contains(&(n as u32)))
}

/// Whether bridges `x` and `y` cross or come within `APART`, but for their two runs at a gate
/// both take, against each other (they fork there).
fn conflicts(x: &Bridge, y: &Bridge) -> bool {
    let skip: Vec<(usize, usize)> = [x.a, x.b]
        .into_iter()
        .filter_map(|g| Some((gate_run(x, g)?, gate_run(y, g)?)))
        .collect();
    (0..x.points.len() - 1).any(|r| {
        (0..y.points.len() - 1).any(|q| {
            let (s, t) = (&x.points[r..r + 2], &y.points[q..q + 2]);
            !skip.contains(&(r, q)) && segments_apart(s[0], s[1], t[0], t[1]) < APART
        })
    })
}

/// The run of `b` (its first point's index) at its gate `g`, if `g` is one of its gates.
fn gate_run(b: &Bridge, g: (usize, u32)) -> Option<usize> {
    (b.a == g)
        .then_some(0)
        .or((b.b == g).then(|| b.points.len() - 2))
}

#[cfg(test)]
#[path = "span_tests.rs"]
mod tests;
