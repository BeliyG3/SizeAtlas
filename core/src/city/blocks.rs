//! The blocks of every district and the lots they are cut into, the empty ones included.

use super::CELL;
use super::empty::{Use, choose};
use super::grid::Grid;
use super::lots::{Cut, Lane, cut, street_room};
use super::plan::District;
use super::plots::{Plot, plots};
use super::rng::Rng;
use std::cmp::Reverse;
use std::f32::consts::FRAC_PI_4;

/// Share of the districts (the core aside) whose blocks are turned by 45 degrees.
const TURNED: f32 = 0.4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LotKind {
    House,
    Filler,
    Square,
    Plaza,
    Vacant,
}

/// A lot: a house is a subfolder of its block; every other kind has the block's id. `parent` is
/// the block's id; the empty kinds have size 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LotInfo {
    pub kind: LotKind,
    pub id: u32,
    pub parent: u32,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Blocks {
    /// Block index per cell, `-1` off the land.
    pub block: Grid<i32>,
    /// Per block: its id (a folder, or the district for a filler), its district's id, its size.
    pub block_info: Vec<(u32, u32, u64)>,
    /// Lot index per cell, `-1` on streets, lanes and gaps.
    pub lot: Grid<i32>,
    pub lots: Vec<LotInfo>,
    /// Lanes of the first two cuts of every built block, ends on the block's edge.
    pub lanes: Vec<Lane>,
    /// The frame of each district's blocks, radians: 0 or π/4.
    pub rot: Vec<f32>,
}

/// Splits the `land` of every district (labels `dist`, by index into `districts`) into blocks,
/// cuts them into lots, and leaves about `inner_empty` m² of them empty.
pub(crate) fn blocks(
    districts: &[District],
    land: &Grid<bool>,
    dist: &Grid<i32>,
    inner_empty: f32,
    rng: &mut Rng,
) -> Blocks {
    let rot: Vec<f32> = (0..districts.len())
        .map(|k| {
            if k > 0 && rng.unit() < TURNED {
                FRAC_PI_4
            } else {
                0.0
            }
        })
        .collect();
    let (block, mut plots, loose) = plots(districts, land, dist, &rot, inner_empty, rng);
    let room = street_room(&block);
    let cuts: Vec<Cut> = plots
        .iter()
        .map(|p| cut(&p.cells, block.w, rot[p.district], &room, rng))
        .collect();
    let free: Vec<usize> = plots
        .iter()
        .map(|p| p.cells.iter().filter(|&&i| !room[i as usize]).count())
        .collect();
    rehome(&mut plots, &cuts);
    let target = (inner_empty.max(0.0) / (CELL * CELL)) as usize;
    let (uses, square) = choose(&plots, &cuts, &free, target, rng);
    place_bytes(&mut plots, &cuts, &uses, &square, &loose);

    let mut lot = Grid::new(block.w, block.h, -1);
    let mut lots = Vec::new();
    let mut lanes = Vec::new();
    let mut put = |cells: &mut dyn Iterator<Item = u32>, info: LotInfo| {
        for i in cells {
            lot.data[i as usize] = lots.len() as i32;
        }
        lots.push(info);
    };
    for (b, (p, c)) in plots.iter().zip(cuts).enumerate() {
        let kind = match uses[b] {
            Use::Plaza => LotKind::Plaza,
            Use::Vacant => LotKind::Vacant,
            Use::Built => {
                for (cells, info) in c.lots.iter().zip(built(p, &c, &square[b])) {
                    put(&mut cells.iter().copied(), info);
                }
                lanes.extend(c.lanes);
                continue;
            }
        };
        if free[b] > 0 {
            let info = LotInfo {
                kind,
                id: p.id,
                parent: p.id,
                size: 0,
            };
            put(
                &mut p.cells.iter().copied().filter(|&i| !room[i as usize]),
                info,
            );
        }
    }
    let block_info = plots
        .iter()
        .map(|p| (p.id, districts[p.district].id, p.size))
        .collect();
    Blocks {
        block,
        block_info,
        lot,
        lots,
        lanes,
        rot,
    }
}

/// A folder block with no lot (too thin for anything but street) trades places with the
/// smallest filler block of its district that has lots, so the folder stays on the map.
fn rehome(plots: &mut [Plot], cuts: &[Cut]) {
    for b in 0..plots.len() {
        if plots[b].filler || !cuts[b].lots.is_empty() {
            continue;
        }
        let k = plots[b].district;
        let to = (0..plots.len())
            .filter(|&o| plots[o].district == k && plots[o].filler && !cuts[o].lots.is_empty())
            .min_by_key(|&o| (plots[o].cells.len(), o));
        if let Some(o) = to {
            // The cells stay where they are; the folder and the filler swap.
            let here = std::mem::take(&mut plots[b].cells);
            let there = std::mem::take(&mut plots[o].cells);
            plots.swap(b, o);
            plots[b].cells = here;
            plots[o].cells = there;
        }
    }
}

/// Hands each district's `loose` bytes, and those of its folder blocks left without a lot to
/// build on, to its built filler blocks by the cells they build on; when it has none, its
/// biggest built block takes them. Bytes go missing only in a district with nothing built.
fn place_bytes(
    plots: &mut [Plot],
    cuts: &[Cut],
    uses: &[Use],
    square: &[Vec<bool>],
    loose: &[u64],
) {
    let built: Vec<u64> = (0..plots.len())
        .map(|b| {
            let lots = cuts[b].lots.iter().zip(&square[b]);
            let open = lots.filter(|(_, s)| !**s).map(|(l, _)| l.len() as u64);
            if uses[b] == Use::Built { open.sum() } else { 0 }
        })
        .collect();
    let mut loose = loose.to_vec();
    let mut area = vec![0u64; loose.len()];
    for (b, p) in plots.iter().enumerate() {
        if !p.filler && built[b] == 0 {
            loose[p.district] += p.size;
        }
        if p.filler {
            area[p.district] += built[b];
        }
    }
    let mut given = vec![0u64; loose.len()];
    let mut last = vec![None; loose.len()];
    for (b, p) in plots.iter_mut().enumerate() {
        if !p.filler {
            continue;
        }
        let k = p.district;
        p.size = if built[b] > 0 {
            last[k] = Some(b);
            (u128::from(loose[k]) * u128::from(built[b]) / u128::from(area[k])) as u64
        } else {
            0
        };
        given[k] += p.size;
    }
    for (k, &left) in loose.iter().enumerate() {
        // Rounding leftovers go to the district's last filler; with none, all to its biggest block.
        let to = last[k].or_else(|| {
            (0..plots.len())
                .filter(|&b| plots[b].district == k && built[b] > 0)
                .max_by_key(|&b| (built[b], Reverse(b)))
        });
        if let Some(b) = to {
            plots[b].size += left - given[k];
        }
    }
}

/// The lots of a built block: its subfolders take the biggest lots that are not squares, the
/// rest are fillers sharing the bytes left (the folder's own files and the subfolders without a
/// lot), by area.
fn built(p: &Plot, c: &Cut, square: &[bool]) -> Vec<LotInfo> {
    let mut order: Vec<usize> = (0..c.lots.len()).filter(|&i| !square[i]).collect();
    order.sort_by_key(|&i| Reverse(c.lots[i].len()));
    let info = |kind, id, size| LotInfo {
        kind,
        id,
        parent: p.id,
        size,
    };
    let mut out = vec![info(LotKind::Square, p.id, 0); c.lots.len()];
    let held = |n: usize| p.children[..n].iter().map(|f| f.size).sum::<u64>();
    let mut houses = order.len().min(p.children.len());
    // Bytes no house holds need a filler: the smallest house gives way if no lot is left.
    if houses > 0 && houses == order.len() && p.size > held(houses) {
        houses -= 1;
    }
    for (&i, f) in order[..houses].iter().zip(p.children) {
        out[i] = info(LotKind::House, f.id, f.size);
    }
    let fillers = &order[houses..];
    let left = p.size.saturating_sub(held(houses));
    let area: u64 = fillers.iter().map(|&i| c.lots[i].len() as u64).sum();
    let mut given = 0;
    for &i in fillers {
        let share = (u128::from(left) * c.lots[i].len() as u128 / u128::from(area)) as u64;
        out[i] = info(LotKind::Filler, p.id, share);
        given += share;
    }
    // Rounding leftovers go to the biggest filler.
    if let Some(&i) = fillers.first() {
        out[i].size += left - given;
    }
    out
}

#[cfg(test)]
#[path = "blocks_tests.rs"]
mod tests;
