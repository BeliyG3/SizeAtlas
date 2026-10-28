//! The city: a root laid out as folder lots with room left for roads between them.
//!
//! Folders near the root become districts (depth 0) and blocks (depth 1) holding the lots
//! of their subfolders; every other lot is a building. A parent's children fill the parent
//! shrunk by [`inset`] of its depth: half a highway around districts, half a street around
//! blocks, half an alley around buildings, so the gaps between lots are the roads.
//!
//! Wire format, all little-endian (offsets are repeated in `src/features/city/bytes.ts`):
//! the 24-byte header of [`super::encode`], then `f32 field | u32 CITY_FORMAT` (32 bytes in
//! all), then `count` records of 32 bytes `f32 x, y, w, h | u32 id | u8 kind | u8 depth |
//! u16 0 | u64 size`, in metres; parents come before their children.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use super::header;
use crate::tree::Tree;
use place::place;

mod place;

/// Road widths in metres.
pub const HIGHWAY: f32 = 24.0;
pub const STREET: f32 = 12.0;
pub const SIDEWALK: f32 = 3.0;
pub const ALLEY: f32 = 2.0;
/// Smallest side of a district or block, and of a building, inside its roads.
pub const MIN_BLOCK: f32 = 30.0;
pub const MIN_BUILDING: f32 = 12.0;
/// Budget of building lots (kinds `Building`, `Annex`, `Others`) in one city.
pub const MAX_BUILDINGS: usize = 5_000;
/// Subfolders of one folder with lots of their own; the rest share one `Others` lot.
pub const MAX_CHILDREN: usize = 24;

pub const CITY_HEADER_LEN: usize = 32;
pub const CITY_RECORD_LEN: usize = 32;
pub const CITY_FORMAT: u32 = 2;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LotKind {
    /// An expanded folder at depth 0.
    District = 0,
    /// An expanded folder at depth 1.
    Block = 1,
    /// A folder that is not expanded.
    Building = 2,
    /// The files directly in a folder; `id` is that folder.
    Annex = 3,
    /// The subfolders past [`MAX_CHILDREN`]; `id` is their parent.
    Others = 4,
}

/// A lot on the field, in metres; `y` is the second axis of the field.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lot {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub id: u32,
    pub kind: LotKind,
    pub depth: u8,
    pub size: u64,
}

/// Road room a lot of `depth` keeps between its edge and its children.
pub fn inset(depth: u8) -> f32 {
    match depth {
        0 => HIGHWAY / 2.0 + SIDEWALK,
        1 => STREET / 2.0 + SIDEWALK,
        _ => ALLEY / 2.0,
    }
}

/// Widest field; a city that needs more keeps fewer districts and blocks.
const MAX_FIELD: f32 = 2400.0;

/// Side of the square field for this many buildings.
pub fn field_side(buildings: usize) -> f32 {
    (40.0 * (buildings as f32).sqrt()).clamp(400.0, MAX_FIELD)
}

/// Smallest side of every planned lot, its road room included, children first: a building
/// keeps [`MIN_BUILDING`], an expanded lot also the room its children need, with slack for
/// the aspect ratios of squarify. Index 0, the root, gets the field side its lots need.
fn least_sides(plan: &[Planned]) -> Vec<f64> {
    let mut sides = vec![0.0; plan.len()];
    for (i, p) in plan.iter().enumerate().rev() {
        let need = p
            .children
            .iter()
            .map(|&k| sides[k] * sides[k])
            .sum::<f64>()
            .sqrt();
        let road = 2.0 * f64::from(inset(p.depth));
        sides[i] = match p.kind {
            _ if i == 0 => 1.2 * need,
            LotKind::District | LotKind::Block => {
                (f64::from(MIN_BLOCK) + road).max(1.25 * need + road)
            }
            _ => f64::from(MIN_BUILDING) + road,
        };
    }
    sides
}

/// [`city_layout_with`] under the default budget [`MAX_BUILDINGS`].
pub fn city_layout(tree: &Tree, root: u32) -> (f32, Vec<Lot>) {
    city_layout_with(tree, root, MAX_BUILDINGS)
}

/// Lays out the folders of `root` on a square field: returns the field side and the lots,
/// parents before their children. The root itself is not a lot.
pub fn city_layout_with(tree: &Tree, root: u32, max_buildings: usize) -> (f32, Vec<Lot>) {
    let (plan, buildings) = plan(tree, root, max_buildings);
    let sides = least_sides(&plan);
    let side = field_side(buildings).max(sides[0] as f32).min(MAX_FIELD);
    (side, place(&plan, &sides, side))
}

/// A lot whose kind is decided but whose place is not yet.
struct Planned {
    kind: LotKind,
    id: u32,
    depth: u8,
    size: u64,
    /// Indexes into the plan, largest first; empty unless the lot is expanded.
    children: Vec<usize>,
}

/// Decides the lots from sizes alone: folders are expanded largest first while the number
/// of buildings stays within `max_buildings`. Index 0 is the root; returns the buildings.
fn plan(tree: &Tree, root: u32, max_buildings: usize) -> (Vec<Planned>, usize) {
    let mut plan = vec![Planned {
        kind: LotKind::District,
        id: root,
        depth: 0,
        size: tree.node(root).size,
        children: Vec::new(),
    }];
    let mut heap = BinaryHeap::new();
    let first = child_lots(tree, root, 0);
    let mut buildings = first.len();
    attach(&mut plan, 0, first, &mut heap);
    while let Some((_, _, index)) = heap.pop() {
        let (id, depth) = (plan[index].id, plan[index].depth);
        let kids = child_lots(tree, id, depth + 1);
        let expanded = buildings - 1 + kids.len();
        if kids.iter().all(|k| k.kind == LotKind::Annex) || expanded > max_buildings {
            continue;
        }
        buildings = expanded;
        plan[index].kind = if depth == 0 {
            LotKind::District
        } else {
            LotKind::Block
        };
        attach(&mut plan, index, kids, &mut heap);
    }
    (plan, buildings)
}

/// Adds `kids` as the children of `parent`; folders that may still expand go on the heap.
fn attach(
    plan: &mut Vec<Planned>,
    parent: usize,
    kids: Vec<Planned>,
    heap: &mut BinaryHeap<(u64, Reverse<u32>, usize)>,
) {
    for kid in kids {
        let index = plan.len();
        if kid.kind == LotKind::Building && kid.depth < 2 {
            heap.push((kid.size, Reverse(kid.id), index));
        }
        plan[parent].children.push(index);
        plan.push(kid);
    }
}

/// The lots inside folder `id` at `depth`, largest first: its largest subfolders, one
/// `Others` lot for the rest, and an `Annex` for its own files. Empty items are left out.
fn child_lots(tree: &Tree, id: u32, depth: u8) -> Vec<Planned> {
    let size = |c: u32| tree.node(c).size;
    let mut dirs: Vec<u32> = tree
        .children(id)
        .filter(|&c| tree.node(c).is_dir() && size(c) > 0)
        .collect();
    dirs.sort_unstable_by_key(|&c| (Reverse(size(c)), c));
    let lot = |kind, id, size| Planned {
        kind,
        id,
        depth,
        size,
        children: Vec::new(),
    };
    let mut lots: Vec<Planned> = dirs
        .iter()
        .take(MAX_CHILDREN)
        .map(|&c| lot(LotKind::Building, c, size(c)))
        .collect();
    let others: u64 = dirs.iter().skip(MAX_CHILDREN).map(|&c| size(c)).sum();
    if others > 0 {
        lots.push(lot(LotKind::Others, id, others));
    }
    let files = size(id).saturating_sub(dirs.iter().map(|&c| size(c)).sum());
    if files > 0 {
        lots.push(lot(LotKind::Annex, id, files));
    }
    // Stable, so equal sizes keep the order above.
    lots.sort_by_key(|l| Reverse(l.size));
    lots
}

/// Serializes a city in the wire format described in the module docs.
pub fn encode_city(
    generation: u64,
    rev: u64,
    approximate: bool,
    field: f32,
    lots: &[Lot],
) -> Vec<u8> {
    let mut out = header(generation, rev, approximate, lots.len(), CITY_RECORD_LEN);
    out.extend_from_slice(&field.to_le_bytes());
    out.extend_from_slice(&CITY_FORMAT.to_le_bytes());
    for lot in lots {
        for v in [lot.x, lot.y, lot.w, lot.h] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.extend_from_slice(&lot.id.to_le_bytes());
        out.extend_from_slice(&[lot.kind as u8, lot.depth, 0, 0]);
        out.extend_from_slice(&lot.size.to_le_bytes());
    }
    out
}

#[cfg(test)]
#[path = "city_tests.rs"]
mod tests;
