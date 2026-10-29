//! The last sharp turns of the overpasses cut in the road graph: where an overpass edge has no
//! other overpass to go on by 45° or less (a square corner, a ramp meeting a highway square on,
//! a hairpin), it bends into the nearest one by a cut at 45°.

use super::chamfer::{MIN, TARGET};
use super::graph::Edge;
use super::lattice::{P, SNAP, dir, metres, step, units};
use super::road::RoadClass;
use super::runs::unit;
use super::smooth_graph::Graph;
use std::collections::{HashMap, HashSet};

/// An overpass's deck, metres: a run shorter than this that cannot bend lies under another.
const DECK: f32 = 16.0;
/// Corners cut at most per sharp turn found at the start (a 135° turn takes two).
const ROUNDS: usize = 4;

/// `nodes` and `edges` (on the lattice, octilinear) with the sharp turns of the overpasses
/// cut. The ends of overpass pieces under [`super::runs::SPECK`] count as one node. An
/// overpass edge `e` leaving such a node with no other overpass edge there to go on by 45° or
/// less bends into the one `f` it turns into the least that leaves room: the straight runs of
/// `e` and `f` are cut back (by about `TARGET / √2`, keeping `MIN` of each run, or half of a
/// run shorter than `2 · MIN`, else up to the run's end; never onto a bridge) to where a cut at
/// 45° to both joins them. Where `e` and `f` were all the node had, `f` up to the cut and the
/// node's own pieces go too. A run under `DECK` that cannot bend goes where the graph stays
/// joined without it. At the `gates` (a shore end and the direction, an index of the eight,
/// its bridge leaves by) the road goes on over the bridge, and the gate's highway stays whole.
/// Nodes left without an edge are dropped.
pub(crate) fn smooth(
    nodes: Vec<[f32; 2]>,
    edges: Vec<Edge>,
    gates: &[([f32; 2], usize)],
) -> (Vec<[f32; 2]>, Vec<Edge>) {
    let gates: HashMap<P, usize> = gates.iter().map(|&(p, k)| (units(p), k)).collect();
    let mut g = Graph {
        held: (nodes.iter())
            .map(|&p| gates.get(&units(p)).copied())
            .collect(),
        at: (nodes.iter().enumerate())
            .map(|(i, &p)| (units(p), i as u32))
            .collect(),
        pts: nodes.iter().map(|&p| units(p)).collect(),
        edges: edges.into_iter().map(Some).collect(),
    };
    let mut failed = HashSet::new();
    let first = g.view().sharp(&failed).len();
    for _ in 0..ROUNDS * first {
        let Some(&(u, k)) = g.view().sharp(&failed).first() else {
            break;
        };
        if !g.cut(u, k) {
            failed.insert((u, k));
        }
    }
    // Without the nodes left with no edge, renumbered in their order.
    let mut edges: Vec<Edge> = g.edges.into_iter().flatten().collect();
    let mut id = vec![u32::MAX; g.pts.len()];
    for e in &edges {
        id[e.a as usize] = 0;
        id[e.b as usize] = 0;
    }
    let mut nodes = Vec::with_capacity(g.pts.len());
    for (i, p) in g.pts.iter().enumerate() {
        if id[i] == 0 {
            id[i] = nodes.len() as u32;
            nodes.push(metres(*p));
        }
    }
    for e in &mut edges {
        (e.a, e.b) = (id[e.a as usize], id[e.b as usize]);
    }
    (nodes, edges)
}

/// An edge a sharp turn may bend into: the node it leaves from, its direction, its run.
type Partner = (u32, usize, Vec<(usize, i64)>);

/// A straight run of overpass edges from a node: the node, the direction, its edges (see
/// [`super::runs::View::run`]).
type Run<'a> = (u32, usize, &'a [(usize, i64)]);

/// How far a cut may take back along a straight run of `len` metres.
fn room(len: f32) -> f32 {
    if len >= 2.0 * MIN {
        len - MIN
    } else {
        0.5 * len
    }
}

fn cross(u: P, v: P) -> i64 {
    u[0] * v[1] - u[1] * v[0]
}

impl Graph {
    /// Cuts the turn of the edge leaving node `u` along `k`; `false` when there is no room.
    fn cut(&mut self, u: u32, k: usize) -> bool {
        let view = self.view();
        let g = view.group[u as usize];
        let leaving = &view.leaving[&g];
        let turn = |j: usize| {
            let d = (j + 12 - k) % 8;
            d.min(8 - d)
        };
        // The edges it turns into the least first, of those the longest runs.
        let mut partners: Vec<Partner> = (leaving.iter())
            .filter(|&&x| x != (u, k))
            .map(|&(w, j)| (w, j, view.run(&self.edges, w, j)))
            .filter(|(.., r)| !r.is_empty())
            .collect();
        partners.sort_by_key(|(w, j, r)| (turn(*j), -r.last().map_or(0, |x| x.1), *w, *j));
        let run_e = view.run(&self.edges, u, k);
        // A gate's highway stays whole from its shore end.
        let gate = |n: u32, r: &[(usize, i64)]| {
            self.is_held(n) && self.edges[r[0].0].is_some_and(|e| e.class == RoadClass::Highway)
        };
        if run_e.is_empty() || gate(u, &run_e) {
            return false;
        }
        // Keeping `MIN` of each run first, then up to the far ends of the runs.
        let found = [true, false].into_iter().find_map(|keep| {
            partners.iter().find_map(|(w, j, run_f)| {
                let (s, s2, a, b) = self.fit((u, k, &run_e), (*w, *j, run_f), keep)?;
                (!self.reaches_held(u, &run_e, s)).then(|| (*w, run_f.clone(), s, s2, a, b))
            })
        });
        let Some((w, run_f, s, s2, a, b)) = found else {
            return self.drop_short(u, &run_e);
        };
        let class = self.edges[run_e[0].0].map_or(RoadClass::Ramp, |e| e.class);
        let members: Vec<u32> = (0..self.pts.len() as u32)
            .filter(|&m| view.group[m as usize] == g)
            .collect();
        let held = members.iter().any(|&m| self.is_held(m));
        let corner = leaving.len() == 2 && !held && self.only_overpasses(&members);
        let a = self.take(u, &run_e, s, a, true);
        let b = self.take(w, &run_f, s2, b, corner);
        if corner {
            let inside = |n: u32| view.group.get(n as usize) == Some(&g);
            for e in self.edges.iter_mut() {
                if e.is_some_and(|e| inside(e.a) && inside(e.b)) {
                    *e = None;
                }
            }
        }
        self.edges.push(Some(Edge {
            a,
            b,
            class,
            bridge: false,
        }));
        true
    }

    /// Where the run `e` leaving node `u` along `k` and the run `f` leaving `w` along `j` are
    /// cut, steps back along each, and the ends of the cut: `a = u + s·vk`, `b = w + s'·vj`,
    /// with `b - a = t·(vj - vk)` at 45° to both. From `w - u = α·vj + β·vk`, `s = t + β` and
    /// `s' = t - α` (all doubled to stay whole). A cut stays off the bridges of a run; with
    /// `keep`, it leaves [`room`] of the run before them, else it may reach them. `None`
    /// without room.
    fn fit(&self, e: Run, f: Run, keep: bool) -> Option<(i64, i64, P, P)> {
        let ((u, k, run_e), (w, j, run_f)) = (e, f);
        let len = |r: &[(usize, i64)], k: usize| {
            let dry = (r.iter())
                .take_while(|x| self.edges[x.0].is_some_and(|e| !e.bridge))
                .last();
            let len = dry.map_or(0, |x| x.1) as f32 * unit(k);
            if keep { room(len) } else { len }
        };
        let (vk, vj) = (step(k), step(j));
        let (pu, pw) = (self.pts[u as usize], self.pts[w as usize]);
        let d = [pw[0] - pu[0], pw[1] - pu[1]];
        let det = cross(vj, vk);
        if det == 0 {
            // Parallel runs: no cut at 45° joins them.
            return None;
        }
        let (a2, b2) = (2 * cross(d, vk) / det, 2 * cross(vj, d) / det);
        let want = (std::f32::consts::SQRT_2 * TARGET / unit(k)) as i64;
        let lo = 1.max(-b2).max(a2);
        let hi = want
            .min((2.0 * len(run_e, k) / unit(k)) as i64 - b2)
            .min((2.0 * len(run_f, j) / unit(j)) as i64 + a2);
        let ends = |t2: i64| {
            let (s, s2) = ((t2 + b2) / 2, (t2 - a2) / 2);
            let a = [pu[0] + s * vk[0], pu[1] + s * vk[1]];
            let b = [pw[0] + s2 * vj[0], pw[1] + s2 * vj[1]];
            (s, s2, a, b)
        };
        let on_lattice = |q: P| q[0] % SNAP == 0 && q[1] % SNAP == 0;
        let whole = |t2: &i64| (t2 + b2) % 2 == 0 && (t2 - a2) % 2 == 0;
        let tries: Vec<i64> = (lo..=hi).rev().filter(whole).collect();
        let fits = tries.iter().take(2 * SNAP as usize).find(|&&t2| {
            let (_, _, a, b) = ends(t2);
            on_lattice(a) && on_lattice(b)
        });
        Some(ends(*fits.or(tries.first())?))
    }

    /// Takes away the run `r` from `u` when it is too short to bend and lies under another
    /// overpass's deck (under `DECK`), its two ends still joined without it; `false` otherwise.
    fn drop_short(&mut self, u: u32, r: &[(usize, i64)]) -> bool {
        // The far end of the run and the run's direction.
        let mut end = u;
        for &(i, _) in r {
            let e = self.edges[i].unwrap_or_else(|| unreachable!());
            end = if e.a == end { e.b } else { e.a };
            if self.is_held(end) {
                return false;
            }
        }
        let (pu, pe) = (self.pts[u as usize], self.pts[end as usize]);
        let Some((k, steps)) = dir(pu, pe) else {
            return false;
        };
        let bridged = r.iter().any(|x| self.edges[x.0].is_some_and(|e| e.bridge));
        if steps as f32 * unit(k) >= DECK || bridged {
            return false;
        }
        let kept: Vec<(usize, Option<Edge>)> = r.iter().map(|x| (x.0, self.edges[x.0])).collect();
        for &(i, _) in &kept {
            self.edges[i] = None;
        }
        if self.joined(u, end) {
            return true;
        }
        for (i, e) in kept {
            self.edges[i] = e;
        }
        false
    }
}

#[cfg(test)]
#[path = "smooth_tests.rs"]
mod tests;
