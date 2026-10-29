//! The vector map of an island: its polygons, road graph, gates and areas.

use super::graph::Edge;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum PolyKind {
    Island = 0,
    Land = 1,
    District = 2,
    Block = 3,
    House = 4,
    Filler = 5,
    Square = 6,
    Plaza = 7,
    Vacant = 8,
    Water = 9,
}

/// The outer outline of one piece of a region, without holes: what lies inside is drawn over it.
/// It runs counter-clockwise in the map frame with `y` pointing down, that is, its signed area by
/// the shoelace formula on `(x, y)` as stored is positive. Every side is at a multiple of 45°.
/// A house's `id` is its folder and `parent` its block; every other lot has its block as both; a
/// block's parent is its district, a district's the root; the island, its land and the canal
/// have the root as both. `size` is the folder's bytes (a region split in pieces repeats it on
/// each, a lot keeps it on its biggest piece), 0 for the empty lots and the water. A house or
/// filler lot the roads took away is made up for: its folder moves to a filler of its block, or
/// its bytes to another building of the block, else they stay with the block's polygon.
#[derive(Clone, Debug, PartialEq)]
pub struct Poly {
    pub kind: PolyKind,
    pub id: u32,
    pub parent: u32,
    pub size: u64,
    pub points: Vec<[f32; 2]>,
}

/// A gate towards neighbouring islands: the road `node` at the shore and the unit vector `dir`
/// pointing out to sea; `neighbours` are indices into [`crate::city::IslandInput::neighbours`].
#[derive(Clone, Debug, PartialEq)]
pub struct Gate {
    pub node: u32,
    pub dir: [f32; 2],
    pub neighbours: Vec<u32>,
}

/// Areas of the island, m²: built up (the land less the empty lots and the canal), empty inside
/// the city (squares, plazas, vacant blocks), the empty shore, and the canal's water.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stats {
    pub built: f32,
    pub inner_empty: f32,
    pub shore: f32,
    pub water: f32,
}

/// The vector map of an island, metres, everything on it within `width` × `height` from
/// `(0, 0)`. Polygons come in drawing order: the island, the canal, the land, the districts, the
/// blocks, the lots; within a kind the bigger first, so one that surrounds another lies under it.
#[derive(Clone, Debug, PartialEq)]
pub struct Island {
    pub width: f32,
    pub height: f32,
    pub polys: Vec<Poly>,
    pub nodes: Vec<[f32; 2]>,
    pub edges: Vec<Edge>,
    pub gates: Vec<Gate>,
    pub stats: Stats,
}

impl Island {
    /// The first gate that faces neighbour `n` (an index into the neighbours, without itself).
    pub(crate) fn facing(&self, n: usize) -> Option<&Gate> {
        (self.gates.iter()).find(|g| g.neighbours.contains(&(n as u32)))
    }
}

/// Moves everything so the top left of the map lies within a metre of `(0, 0)` and sets its size;
/// returns the shift taken off every point.
pub(super) fn frame(island: &mut Island) -> [f32; 2] {
    let all = island
        .polys
        .iter()
        .flat_map(|p| p.points.iter())
        .chain(island.nodes.iter());
    let (mut lo, mut hi) = ([f32::INFINITY; 2], [f32::NEG_INFINITY; 2]);
    for p in all {
        for a in 0..2 {
            lo[a] = lo[a].min(p[a]);
            hi[a] = hi[a].max(p[a]);
        }
    }
    if !lo[0].is_finite() {
        return [0.0; 2];
    }
    // Whole metres keep the nodes on their lattice.
    let lo = lo.map(f32::floor);
    let shift = |p: &mut [f32; 2]| *p = [p[0] - lo[0], p[1] - lo[1]];
    island
        .polys
        .iter_mut()
        .flat_map(|p| p.points.iter_mut())
        .for_each(shift);
    island.nodes.iter_mut().for_each(shift);
    (island.width, island.height) = (hi[0] - lo[0], hi[1] - lo[1]);
    lo
}
