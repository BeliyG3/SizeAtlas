//! The whole island as a vector map: districts, land, blocks, roads, the canal and the shore.

use super::CELL;
use super::blocks::{Blocks, LotInfo, LotKind, blocks};
use super::canal::{canal, water};
use super::graph::{Edge, along, build, keep_connected, length};
use super::grid::Grid;
use super::highways::{Highways, highways};
use super::land::{land, seeds};
use super::lattice::{metres, nearest_dir, snap_line};
use super::map::{Gate, Island, Poly, PolyKind, Stats, frame};
use super::outline::outline;
use super::path::apart;
use super::plan::{IslandInput, built_area, districts, empty_ratio};
use super::rehome::{Rehomed, lot_polys};
use super::rng::Rng;
use super::road::RoadClass;
use super::shore::{face, shore};
use super::smooth::smooth;
use super::streets::streets;
use super::trim::clear_roads;
use super::vector::{Fit, area, outlines, trace};
use super::voronoi::voronoi;

/// Room around the land's bounding box on its field, metres (the shore has its own raster).
const MARGIN: f32 = 0.0;
/// Rounds of the districts' weight fit.
const ROUNDS: usize = 50;
/// A gate's node lies this close to its highway's shore end, metres.
const GATE_NODE: f32 = 3.0;

/// The island of `input`: districts, land, blocks, highways (the houses under them and their
/// ramps cleared), the canal (the houses in its water cleared), the shore, then the vector map.
pub fn island(input: &IslandInput) -> Island {
    assemble(input).0
}

/// What the island was checked against in the tests.
#[cfg_attr(not(test), allow(dead_code))] // Read by the tests only.
pub(super) struct Trace {
    /// Share of the road length left off for not joining the core's roads.
    pub dropped: f32,
    /// The canal's axis in the map's frame, empty without a canal.
    pub canal: Vec<[f32; 2]>,
    /// The lots as the blocks made them, and as the map keeps them.
    pub placed: Vec<LotInfo>,
    pub kept: Rehomed,
    /// The loose ends of the streets and lanes before the overpasses were smoothed, in the
    /// map's frame.
    pub loose: Vec<[f32; 2]>,
}

/// [`island`], and what the tests check it against.
pub(super) fn assemble(input: &IslandInput) -> (Island, Trace) {
    let root = &input.root;
    let districts = districts(root);
    let b = built_area(root.size);
    let r = empty_ratio(root.size, input.free);
    let inner = (0.6 * r * b).min(0.5 * b);
    let mut rng = Rng::new(input.seed);
    let weights: Vec<f32> = districts
        .iter()
        .map(|d| (d.size.max(1) as f64).sqrt() as f32)
        .collect();
    let sum: f32 = weights.iter().sum();
    let areas: Vec<f32> = weights.iter().map(|w| w / sum * (b + inner)).collect();
    let mut at = seeds(districts.len(), &mut rng);
    let land = land(&areas, &mut at, MARGIN, &mut rng);
    let cells = count(&land.data) as f32 * CELL * CELL;
    let targets: Vec<f32> = weights.iter().map(|w| w / sum * cells).collect();
    let dist = voronoi(&land, &at, &targets, 0.0, ROUNDS);
    let blocks = blocks(&districts, &land, &dist, inner, &mut rng);
    let core = at[0];
    let ways = highways(&land, &dist, core, &input.neighbours);
    let axis = canal(&land, core, &mut rng).unwrap_or_default();
    let wet = if axis.is_empty() {
        Grid::new(land.w, land.h, false)
    } else {
        water(&axis, land.w, land.h)
    };

    let (nodes, edges) = build(segments(&blocks, &ways), &wet, &axis);
    let total: f32 = edges.iter().map(|e| length(&nodes, e)).sum();
    let gate_ends: Vec<([f32; 2], usize)> = (shore_ends(&ways).into_iter())
        .flat_map(|(s, k)| {
            let near = nodes
                .iter()
                .copied()
                .filter(move |&p| apart(p, s) <= GATE_NODE);
            near.map(move |p| (p, k))
        })
        .collect();
    let loose = loose_ends(&nodes, &edges);
    let (nodes, edges) = smooth(nodes, edges, &gate_ends);
    let (nodes, edges, dropped) = keep_connected(nodes, edges, core);
    let mut lot = blocks.lot.clone();
    clear_roads(&mut lot, &nodes, &edges);
    for (l, &w) in lot.data.iter_mut().zip(&wet.data) {
        if w {
            *l = -1;
        }
    }

    let dry: Vec<bool> = land
        .data
        .iter()
        .zip(&wet.data)
        .map(|(&l, &w)| l && !w)
        .collect();
    let empty = |l: i32| {
        l >= 0
            && matches!(
                blocks.lots[l as usize].kind,
                LotKind::Square | LotKind::Plaza | LotKind::Vacant
            )
    };
    let inner_empty = lot.data.iter().filter(|&&l| empty(l)).count() as f32 * CELL * CELL;
    let built = count(&dry) as f32 * CELL * CELL - inner_empty;
    let band = shore(
        &land,
        &axis,
        (r * built - inner_empty).max(0.0),
        face(&input.neighbours),
        &mut rng,
    );
    let shape = outline(&land, &band, &axis);
    let stats = Stats {
        built,
        inner_empty,
        shore: count(&band.grid.data) as f32 * band.cell * band.cell,
        water: shape.water_area,
    };

    let mut polys = Vec::new();
    let whole = |kind, points| Poly {
        kind,
        id: root.id,
        parent: root.id,
        size: if kind == PolyKind::Water {
            0
        } else {
            root.size
        },
        points,
    };
    polys.extend(shape.island.into_iter().map(|p| whole(PolyKind::Island, p)));
    polys.extend(shape.water.map(|p| whole(PolyKind::Water, p)));
    let on_dry = |g: &Grid<i32>| Grid {
        data: (g.data.iter().zip(&dry))
            .map(|(&l, &d)| if d { l } else { -1 })
            .collect(),
        ..*g
    };
    let land_labels = Grid {
        data: dry.iter().map(|&d| if d { 0 } else { -1 }).collect(),
        w: land.w,
        h: land.h,
    };
    for p in trace(&land_labels, 0) {
        polys.push(whole(PolyKind::Land, p));
    }
    for (l, p) in outlines(&on_dry(&dist), None, CELL, [0.0; 2], Fit::Near) {
        let d = &districts[l as usize];
        polys.push(poly(PolyKind::District, d.id, root.id, d.size, p));
    }
    for (l, p) in outlines(&on_dry(&blocks.block), None, CELL, [0.0; 2], Fit::Near) {
        let (id, parent, size) = blocks.block_info[l as usize];
        polys.push(poly(PolyKind::Block, id, parent, size, p));
    }
    let (lots, kept) = lot_polys(&blocks, &lot);
    polys.extend(lots);
    polys.retain(|p| p.points.len() <= usize::from(u16::MAX));
    polys.sort_by(|p, q| {
        rank(p.kind)
            .cmp(&rank(q.kind))
            .then(area(&q.points).total_cmp(&area(&p.points)))
    });

    let gates = gates(&ways, &nodes, &edges);
    let mut out = Island {
        width: 0.0,
        height: 0.0,
        polys,
        nodes,
        edges,
        gates,
        stats,
    };
    let shift = frame(&mut out);
    let trace = Trace {
        dropped: if total > 0.0 { dropped / total } else { 0.0 },
        canal: axis
            .iter()
            .map(|p| [p[0] - shift[0], p[1] - shift[1]])
            .collect(),
        placed: blocks.lots,
        kept,
        loose: (loose.iter())
            .map(|p| [p[0] - shift[0], p[1] - shift[1]])
            .collect(),
    };
    (out, trace)
}

/// The nodes where a street or a lane ends with no other road.
pub(super) fn loose_ends(nodes: &[[f32; 2]], edges: &[Edge]) -> Vec<[f32; 2]> {
    let mut deg = vec![(0, false); nodes.len()];
    for e in edges {
        for n in [e.a as usize, e.b as usize] {
            deg[n].0 += 1;
            deg[n].1 |= e.class.overpass();
        }
    }
    (deg.iter().zip(nodes))
        .filter(|((d, over), _)| *d == 1 && !over)
        .map(|(_, &p)| p)
        .collect()
}

fn poly(kind: PolyKind, id: u32, parent: u32, size: u64, points: Vec<[f32; 2]>) -> Poly {
    Poly {
        kind,
        id,
        parent,
        size,
        points,
    }
}

fn count(cells: &[bool]) -> usize {
    cells.iter().filter(|&&c| c).count()
}

/// Drawing order of the kinds: the lots side by side last.
fn rank(k: PolyKind) -> u8 {
    match k {
        PolyKind::Island => 0,
        PolyKind::Water => 1,
        PolyKind::Land => 2,
        PolyKind::District => 3,
        PolyKind::Block => 4,
        _ => 5,
    }
}

/// The road segments of the island, metres: the streets on every block border and the coast,
/// the lanes, the highways, the ring and the ramps, each snapped onto the lattice.
fn segments(blocks: &Blocks, ways: &Highways) -> Vec<([f32; 2], [f32; 2], RoadClass)> {
    let mut out = Vec::new();
    let mut add = |line: &[[f32; 2]], class| {
        for s in along(&snap_line(line), class) {
            out.push((metres(s.a), metres(s.b), class));
        }
    };
    for line in &ways.lines {
        add(line, RoadClass::Highway);
    }
    for line in &ways.ring {
        add(line, RoadClass::Ring);
    }
    for line in &ways.ramps {
        add(line, RoadClass::Ramp);
    }
    for line in streets(&blocks.block) {
        add(&line, RoadClass::Street);
    }
    for &(a, b, _) in &blocks.lanes {
        add(&[a, b], RoadClass::Lane);
    }
    out
}

/// The shore ends of the gates' highways (metres) and their outward directions (indices of
/// the eight), gate by gate.
fn shore_ends(ways: &Highways) -> Vec<([f32; 2], usize)> {
    (ways.gates.iter())
        .filter_map(|(line, dir, _)| {
            let shore = metres(*snap_line(&ways.lines[*line]).first()?);
            Some((shore, nearest_dir(*dir)))
        })
        .collect()
}

/// The gates whose highway still reaches the shore in the graph: each at the highway node
/// nearest to its line's shore end.
fn gates(ways: &Highways, nodes: &[[f32; 2]], edges: &[Edge]) -> Vec<Gate> {
    let mut on_highway = vec![false; nodes.len()];
    for e in edges.iter().filter(|e| e.class == RoadClass::Highway) {
        on_highway[e.a as usize] = true;
        on_highway[e.b as usize] = true;
    }
    ways.gates
        .iter()
        .filter_map(|(line, dir, faced)| {
            let shore = metres(*snap_line(&ways.lines[*line]).first()?);
            let off = |i: usize| apart(nodes[i], shore);
            let node = (0..nodes.len())
                .filter(|&i| on_highway[i])
                .min_by(|&i, &j| off(i).total_cmp(&off(j)))?;
            (off(node) <= GATE_NODE).then(|| Gate {
                node: node as u32,
                dir: *dir,
                neighbours: faced.iter().map(|&n| n as u32).collect(),
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "island_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "island_turns_tests.rs"]
mod turns_tests;
