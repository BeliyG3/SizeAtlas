//! Cutting a block into lots along the axes of its frame, clear of the street room.

use super::CELL;
use super::grid::{Grid, borders};
use super::rng::Rng;

/// A straight lane: both ends in world metres, and its width.
pub(crate) type Lane = ([f32; 2], [f32; 2], f32);

/// A block cut into lots: every lot's cells (street room left out, lots left with no cell
/// dropped) and the lanes of the first two cuts.
pub(super) struct Cut {
    pub lots: Vec<Vec<u32>>,
    pub lanes: Vec<Lane>,
}

/// Cells closer than this to a block border (or the coast) are left for the 10 m street, m.
/// Half the street plus a little: a border cell lies on one side of the true border, and on a
/// 45-degree border the cells' corners reach farther; at 5.5 both kinds of street keep 10 m
/// between the lots' squares (axis-aligned ones are the same as at 5).
const STREET_ROOM: f32 = 5.5;
/// A piece whose longer side is shorter than a lot side drawn from this range stays whole, m.
const LOT: (f32, f32) = (18.0, 40.0);
/// A piece smaller than this stays whole whatever its shape, m².
const MIN_LOT_AREA: f32 = 250.0;
/// Share of the cuts that run along the long side instead of across it.
const ALONG: f32 = 0.15;
/// Where a cut falls, as a share of the piece's span.
const AT: (f32, f32) = (0.35, 0.65);
/// Gap a cut leaves, by its depth: a lane, a narrower lane, then a passage between houses, m.
const WIDTHS: [f32; 3] = [5.0, 3.0, 1.6];
/// Cuts this shallow are lanes for the road graph; deeper ones are only gaps.
const LANE_DEPTH: usize = 2;
/// A lane breaks where the cells along its line are farther apart than this (a bay of the
/// block), m.
const RUN_GAP: f32 = 2.0 * CELL;

/// Cells closer than `STREET_ROOM` to a cell of a border of `block` (labels, `-1` off the land):
/// a disc stamped around every border cell, cheaper than a distance transform of the field.
pub(super) fn street_room(block: &Grid<i32>) -> Vec<bool> {
    let reach = (STREET_ROOM / CELL) as i64;
    let mut disc = Vec::new();
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            if (((dx * dx + dy * dy) as f32).sqrt() * CELL) < STREET_ROOM {
                disc.push((dx, dy));
            }
        }
    }
    let (w, h) = (block.w as i64, block.h as i64);
    let mut room = vec![false; block.data.len()];
    let edge = borders(block);
    for (i, _) in edge.data.iter().enumerate().filter(|(_, e)| **e) {
        let (x, y) = (i as i64 % w, i as i64 / w);
        for &(dx, dy) in &disc {
            let (nx, ny) = (x + dx, y + dy);
            if nx >= 0 && ny >= 0 && nx < w && ny < h {
                room[(ny * w + nx) as usize] = true;
            }
        }
    }
    room
}

/// Cuts a block of `cells` (indices into a grid `w` wide) recursively along the axes of the
/// frame turned by `rot`, until each piece fits a lot. Cells in `room` belong to no lot.
pub(super) fn cut(cells: &[u32], w: usize, rot: f32, room: &[bool], rng: &mut Rng) -> Cut {
    let (cos, sin) = (rot.cos(), rot.sin());
    let uv: Vec<[f32; 2]> = cells
        .iter()
        .map(|&i| {
            let x = ((i as usize % w) as f32 + 0.5) * CELL;
            let y = ((i as usize / w) as f32 + 0.5) * CELL;
            [x * cos + y * sin, y * cos - x * sin]
        })
        .collect();
    let mut out = Cut {
        lots: Vec::new(),
        lanes: Vec::new(),
    };
    let mut stack = vec![((0..cells.len() as u32).collect::<Vec<u32>>(), 0usize)];
    while let Some((ids, depth)) = stack.pop() {
        if ids.is_empty() {
            continue;
        }
        let (mut lo, mut hi) = ([f32::INFINITY; 2], [f32::NEG_INFINITY; 2]);
        for &j in &ids {
            for a in 0..2 {
                lo[a] = lo[a].min(uv[j as usize][a]);
                hi[a] = hi[a].max(uv[j as usize][a]);
            }
        }
        let span = [hi[0] - lo[0], hi[1] - lo[1]];
        let side = rng.range(LOT.0, LOT.1);
        let fits = span[0].max(span[1]) < side || ids.len() as f32 * CELL * CELL < MIN_LOT_AREA;
        let width = WIDTHS[depth.min(WIDTHS.len() - 1)];
        let line = if fits {
            None
        } else {
            // Axis `a` is the one the cut crosses: the long side's, now and then the short one's.
            // A cut leaves at least a lot's least side on both of its sides; when the piece is too
            // short for that along this axis, the other one is tried.
            let long = usize::from(span[1] > span[0]);
            let first = if rng.unit() < ALONG { 1 - long } else { long };
            let share = rng.range(AT.0, AT.1);
            [first, 1 - first].into_iter().find_map(|a| {
                let (min, max) = (lo[a] + LOT.0 + width / 2.0, hi[a] - LOT.0 - width / 2.0);
                (min <= max).then(|| (a, (lo[a] + span[a] * share).clamp(min, max)))
            })
        };
        let Some((a, at)) = line else {
            let lot: Vec<u32> = ids
                .iter()
                .map(|&j| cells[j as usize])
                .filter(|&i| !room[i as usize])
                .collect();
            if !lot.is_empty() {
                out.lots.push(lot);
            }
            continue;
        };
        let (mut below, mut above, mut gap) = (Vec::new(), Vec::new(), Vec::new());
        for &j in &ids {
            let q = uv[j as usize][a];
            if (q - at).abs() < width / 2.0 {
                gap.push(j);
            } else if q < at {
                below.push(j);
            } else {
                above.push(j);
            }
        }
        if depth < LANE_DEPTH {
            lanes(&uv, &gap, a, at, width, rot, &mut out.lanes);
        }
        stack.push((below, depth + 1));
        stack.push((above, depth + 1));
    }
    out
}

/// The lanes along the line `q[a] = at` through the `gap` cells: one per run of the cells on
/// the line (within half a cell of it) without a break, from its first cell to its last.
fn lanes(
    uv: &[[f32; 2]],
    gap: &[u32],
    a: usize,
    at: f32,
    width: f32,
    rot: f32,
    out: &mut Vec<Lane>,
) {
    let mut along: Vec<f32> = gap
        .iter()
        .map(|&j| uv[j as usize])
        .filter(|p| (p[a] - at).abs() <= 0.5 * CELL)
        .map(|p| p[1 - a])
        .collect();
    along.sort_by(f32::total_cmp);
    let mut start = 0;
    for k in 1..=along.len() {
        if k < along.len() && along[k] - along[k - 1] <= RUN_GAP {
            continue;
        }
        let (p0, p1) = (along[start], along[k - 1]);
        if p1 - p0 >= CELL {
            out.push((world(a, at, p0, rot), world(a, at, p1, rot), width));
        }
        start = k;
    }
}

/// The world point of the block-frame point with `at` on axis `a` and `p` on the other.
fn world(a: usize, at: f32, p: f32, rot: f32) -> [f32; 2] {
    let (u, v) = if a == 0 { (at, p) } else { (p, at) };
    let (cos, sin) = (rot.cos(), rot.sin());
    [u * cos - v * sin, u * sin + v * cos]
}
