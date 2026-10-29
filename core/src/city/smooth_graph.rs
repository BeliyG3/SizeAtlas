//! The road graph as [`super::smooth`] edits it: nodes on the lattice found by their point,
//! edges taken away or split along straight runs, the gates' shore ends held.

use super::graph::Edge;
use super::lattice::P;
use super::runs::View;
use std::collections::HashMap;

/// A road graph being smoothed: nodes on the lattice, edges that may go (`None`).
pub(crate) struct Graph {
    /// Per node (of the input): the way out over a gate's bridge.
    pub held: Vec<Option<usize>>,
    pub at: HashMap<P, u32>,
    pub pts: Vec<P>,
    pub edges: Vec<Option<Edge>>,
}

impl Graph {
    pub fn is_held(&self, n: u32) -> bool {
        self.held.get(n as usize).is_some_and(Option::is_some)
    }

    /// The overpasses as the turns see them, the ways out over the bridges with them.
    pub fn view(&self) -> View {
        let out: Vec<(u32, usize)> = (self.held.iter().enumerate())
            .filter_map(|(n, k)| Some((n as u32, (*k)?)))
            .collect();
        View::new(&self.pts, &self.edges, &out)
    }

    /// Whether the run `r` from `n` reaches a held node within `s` steps.
    pub fn reaches_held(&self, n: u32, r: &[(usize, i64)], s: i64) -> bool {
        let mut at = n;
        for &(i, _) in r.iter().take_while(|x| x.1 <= s) {
            let e = self.edges[i].unwrap_or_else(|| unreachable!());
            at = if e.a == at { e.b } else { e.a };
            if self.is_held(at) {
                return true;
            }
        }
        false
    }

    pub fn node(&mut self, p: P) -> u32 {
        let next = self.pts.len() as u32;
        let id = *self.at.entry(p).or_insert(next);
        if id == next {
            self.pts.push(p);
        }
        id
    }

    /// Whether the edges join nodes `a` and `b`.
    pub fn joined(&self, a: u32, b: u32) -> bool {
        let mut near = vec![Vec::new(); self.pts.len()];
        for e in self.edges.iter().flatten() {
            near[e.a as usize].push(e.b);
            near[e.b as usize].push(e.a);
        }
        let mut seen = vec![false; self.pts.len()];
        let mut stack = vec![a];
        seen[a as usize] = true;
        while let Some(n) = stack.pop() {
            if n == b {
                return true;
            }
            for &m in &near[n as usize] {
                if !std::mem::replace(&mut seen[m as usize], true) {
                    stack.push(m);
                }
            }
        }
        false
    }

    /// Whether every edge at the `nodes` is an overpass.
    pub fn only_overpasses(&self, nodes: &[u32]) -> bool {
        (self.edges.iter().flatten())
            .filter(|e| nodes.contains(&e.a) || nodes.contains(&e.b))
            .all(|e| e.class.overpass())
    }

    /// The node at `q`, `s` steps along the run `r` from `n`: the edge it falls on split there,
    /// and with `drop` the run from `n` up to it taken away.
    pub fn take(&mut self, n: u32, r: &[(usize, i64)], s: i64, q: P, drop: bool) -> u32 {
        let id = self.node(q);
        let mut near = n;
        for &(e, upto) in r.iter().filter(|_| s > 0) {
            let edge = self.edges[e].unwrap_or_else(|| unreachable!());
            let far = if edge.a == near { edge.b } else { edge.a };
            if upto < s {
                if drop {
                    self.edges[e] = None;
                }
            } else {
                if upto > s {
                    self.edges[e] = Some(Edge {
                        a: id,
                        b: far,
                        ..edge
                    });
                    if !drop {
                        self.edges.push(Some(Edge {
                            a: near,
                            b: id,
                            ..edge
                        }));
                    }
                } else if drop {
                    self.edges[e] = None;
                }
                break;
            }
            near = far;
        }
        id
    }
}
