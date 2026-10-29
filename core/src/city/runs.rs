//! The overpasses of a road graph as the turns see them: the edges round each node, the
//! nodes that a jog of the lattice joins into one, the turns sharper than 45° and the straight
//! runs.

use super::graph::Edge;
use super::lattice::{P, UNIT, dir};
use std::collections::{HashMap, HashSet};

/// Overpass pieces shorter than this are a jog of the lattice, not a run: their ends count as
/// one node, metres.
pub(crate) const SPECK: f32 = 4.0;

/// The overpasses of a road graph round its nodes.
pub(crate) struct View {
    /// Per node: its overpass edges, their direction from it and steps.
    pub around: Vec<Vec<(usize, usize, i64)>>,
    /// Per node: the first node of its group (nodes joined by pieces under `SPECK`).
    pub group: Vec<usize>,
    /// Per group: the overpass edges that leave it, as (node, direction).
    pub leaving: HashMap<usize, Vec<(u32, usize)>>,
    /// Per node: its other roads (streets and lanes).
    pub others: Vec<u32>,
}

/// Metres per unit step of direction `k`.
pub(crate) fn unit(k: usize) -> f32 {
    if k % 2 == 1 {
        std::f32::consts::SQRT_2 / UNIT
    } else {
        1.0 / UNIT
    }
}

fn root(up: &mut [usize], mut i: usize) -> usize {
    while up[i] != i {
        up[i] = up[up[i]];
        i = up[i];
    }
    i
}

impl View {
    /// The steps along the run `r` from `n` a cut may take it away for: up to its first bridge,
    /// and up to the first node a street or lane ends at (it would be left loose).
    pub fn free(&self, edges: &[Option<Edge>], n: u32, r: &[(usize, i64)]) -> i64 {
        let mut at = n;
        let mut out = 0;
        for &(i, upto) in r {
            let e = edges[i].unwrap_or_else(|| unreachable!());
            if e.bridge {
                break;
            }
            out = upto;
            at = if e.a == at { e.b } else { e.a };
            if self.others[at as usize] == 1 {
                break;
            }
        }
        out
    }

    /// The overpasses among `edges` between the points `pts` (lattice units), and the ways
    /// `out` of the graph (a node and a direction) that leave as an overpass would.
    pub fn new(pts: &[P], edges: &[Option<Edge>], out: &[(u32, usize)]) -> Self {
        let n = pts.len();
        let mut around = vec![Vec::new(); n];
        let mut up: Vec<usize> = (0..n).collect();
        let mut others = vec![0; n];
        for (i, e) in edges.iter().enumerate() {
            let Some(e) = e.filter(|e| e.class.overpass()) else {
                if let Some(e) = e {
                    others[e.a as usize] += 1;
                    others[e.b as usize] += 1;
                }
                continue;
            };
            let (a, b) = (e.a as usize, e.b as usize);
            if let Some((k, steps)) = dir(pts[a], pts[b]) {
                around[a].push((i, k, steps));
                around[b].push((i, (k + 4) % 8, steps));
                if steps as f32 * unit(k) < SPECK {
                    let (ra, rb) = (root(&mut up, a), root(&mut up, b));
                    up[ra.max(rb)] = ra.min(rb);
                }
            }
        }
        let group: Vec<usize> = (0..n).map(|i| root(&mut up, i)).collect();
        let mut leaving: HashMap<usize, Vec<(u32, usize)>> = HashMap::new();
        for (u, here) in around.iter().enumerate() {
            for &(e, k, _) in here {
                let edge = edges[e].unwrap_or_else(|| unreachable!());
                let far = if edge.a as usize == u { edge.b } else { edge.a };
                if group[far as usize] != group[u] {
                    leaving.entry(group[u]).or_default().push((u as u32, k));
                }
            }
        }
        for &(u, k) in out {
            leaving.entry(group[u as usize]).or_default().push((u, k));
        }
        Self {
            around,
            group,
            leaving,
            others,
        }
    }

    /// The sharp turns not given up on: the node an overpass edge leaves its group from, and
    /// its direction, where no other edge leaving the group goes on by 45° or less.
    pub fn sharp(&self, failed: &HashSet<(u32, usize)>) -> Vec<(u32, usize)> {
        let mut groups: Vec<&usize> = self.leaving.keys().collect();
        groups.sort_unstable();
        let mut out = Vec::new();
        for l in groups.into_iter().map(|g| &self.leaving[g]) {
            for &(u, k) in l.iter().filter(|_| l.len() > 1) {
                let on = l.iter().any(|&(_, j)| matches!((j + 8 - k) % 8, 3..=5));
                if !on && !failed.contains(&(u, k)) {
                    out.push((u, k));
                }
            }
        }
        out
    }

    /// The straight run of overpass edges from `n` along `k`, up to the first node where another
    /// overpass meets it: its edges, each with the steps from `n` to its far end.
    pub fn run(&self, edges: &[Option<Edge>], n: u32, k: usize) -> Vec<(usize, i64)> {
        let mut out = Vec::new();
        let (mut at, mut total) = (n, 0);
        while let Some(&(e, _, steps)) = self.around[at as usize].iter().find(|x| x.1 == k) {
            total += steps;
            out.push((e, total));
            let edge = edges[e].unwrap_or_else(|| unreachable!());
            at = if edge.a == at { edge.b } else { edge.a };
            if self.around[at as usize].len() != 2 || out.len() > self.around.len() {
                break;
            }
        }
        out
    }
}
