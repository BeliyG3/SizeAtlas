//! The road graph: straight octilinear edges between nodes, built from the road segments of an
//! island.

use super::bridges::bridges;
use super::grid::Grid;
use super::lattice::{P, metres, snap_line, units};
use super::merge::absorb;
use super::path::apart;
use super::road::{RoadClass, Seg};
use super::split::{degrees, extensions, split};
use std::collections::HashMap;

/// A straight road between nodes `a` and `b`; a bend is a node of degree 2.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Edge {
    pub a: u32,
    pub b: u32,
    pub class: RoadClass,
    /// Over the canal's water.
    pub bridge: bool,
}

/// Loose pieces shorter than this are dropped, metres.
const MIN_EDGE: f32 = 1.0;

/// The graph of `segments` (metres, each straight at a multiple of 45°, ideally on the lines of
/// [`snap_line`]): roads that run side by side merged (the higher class kept: Highway > Ring >
/// Ramp > Street > Lane), cut at every crossing and junction, loose ends carried on to the next
/// road (a lane up to 6 m, others up to 20 m), stretches over the `water` (cells of `CELL`
/// metres) of the canal along `axis` made bridges or cut off (see [`bridges`]), and loose pieces
/// under 1 m and bridges with a loose end dropped. Nodes lie on the 1/64 m lattice, so every edge
/// keeps its exact direction.
pub(crate) fn build(
    segments: Vec<([f32; 2], [f32; 2], RoadClass)>,
    water: &Grid<bool>,
    axis: &[[f32; 2]],
) -> (Vec<[f32; 2]>, Vec<Edge>) {
    let mut segs = Vec::with_capacity(segments.len());
    for (a, b, class) in segments {
        let s = Seg {
            a: units(a),
            b: units(b),
            class,
        };
        if s.dir().is_some() {
            segs.push(s);
        } else {
            segs.extend(along(&snap_line(&[a, b]), class));
        }
    }
    let mut pieces = split(&absorb(segs));
    let more = extensions(&pieces);
    if !more.is_empty() {
        pieces.extend(more);
        pieces = split(&pieces);
    }
    let pieces = prune(bridges(pieces, water, axis));
    index(&pieces)
}

/// The segments of a snapped polyline.
pub(crate) fn along(line: &[P], class: RoadClass) -> Vec<Seg> {
    line.windows(2)
        .map(|w| Seg {
            a: w[0],
            b: w[1],
            class,
        })
        .collect()
}

/// `pieces` without the loose ones shorter than `MIN_EDGE` and the loose bridges, again and
/// again.
fn prune(mut pieces: Vec<(Seg, bool)>) -> Vec<(Seg, bool)> {
    loop {
        let deg = degrees(&pieces.iter().map(|p| p.0).collect::<Vec<_>>());
        let before = pieces.len();
        pieces.retain(|(s, bridge)| {
            let held = deg[&s.a] > 1 && deg[&s.b] > 1;
            held || (s.len() >= MIN_EDGE && !bridge)
        });
        if pieces.len() == before {
            return pieces;
        }
    }
}

/// Nodes (metres) in the order the pieces first reach them, and the edges between them.
fn index(pieces: &[(Seg, bool)]) -> (Vec<[f32; 2]>, Vec<Edge>) {
    let mut ids: HashMap<P, u32> = HashMap::new();
    let mut nodes = Vec::new();
    let mut id = |p: P, nodes: &mut Vec<[f32; 2]>| {
        *ids.entry(p).or_insert_with(|| {
            nodes.push(metres(p));
            nodes.len() as u32 - 1
        })
    };
    let edges = pieces
        .iter()
        .map(|&(s, bridge)| Edge {
            a: id(s.a, &mut nodes),
            b: id(s.b, &mut nodes),
            class: s.class,
            bridge,
        })
        .collect();
    (nodes, edges)
}

/// Length of edge `e`, metres.
pub(crate) fn length(nodes: &[[f32; 2]], e: &Edge) -> f32 {
    apart(nodes[e.a as usize], nodes[e.b as usize])
}

/// The part of the graph connected to the node nearest `centre`, renumbered from 0 in the old
/// order, and the length of the edges left out, metres.
pub(crate) fn keep_connected(
    nodes: Vec<[f32; 2]>,
    edges: Vec<Edge>,
    centre: [f32; 2],
) -> (Vec<[f32; 2]>, Vec<Edge>, f32) {
    let start = (0..nodes.len())
        .min_by(|&i, &j| apart(nodes[i], centre).total_cmp(&apart(nodes[j], centre)));
    let Some(start) = start else {
        return (nodes, edges, 0.0);
    };
    let mut near: Vec<Vec<u32>> = vec![Vec::new(); nodes.len()];
    for e in &edges {
        near[e.a as usize].push(e.b);
        near[e.b as usize].push(e.a);
    }
    let mut seen = vec![false; nodes.len()];
    let mut stack = vec![start as u32];
    seen[start] = true;
    while let Some(n) = stack.pop() {
        for &m in &near[n as usize] {
            if !seen[m as usize] {
                seen[m as usize] = true;
                stack.push(m);
            }
        }
    }
    let mut new_id = vec![u32::MAX; nodes.len()];
    let mut kept = Vec::new();
    for (i, p) in nodes.iter().enumerate().filter(|&(i, _)| seen[i]) {
        new_id[i] = kept.len() as u32;
        kept.push(*p);
    }
    let mut dropped = 0.0;
    let mut out = Vec::with_capacity(edges.len());
    for e in edges {
        if seen[e.a as usize] {
            out.push(Edge {
                a: new_id[e.a as usize],
                b: new_id[e.b as usize],
                ..e
            });
        } else {
            dropped += length(&nodes, &e);
        }
    }
    (kept, out, dropped)
}

#[cfg(test)]
#[path = "graph_tests.rs"]
mod tests;
