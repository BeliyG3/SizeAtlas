//! The lots' polygons, every folder and its bytes kept on the map when the roads and the canal
//! take lots away.

use super::CELL;
use super::blocks::{Blocks, LotInfo, LotKind};
use super::grid::Grid;
use super::map::{Poly, PolyKind};
use super::vector::{Fit, area, outlines};

/// The lots after the lost ones were made up for.
#[cfg_attr(not(test), allow(dead_code))] // The counts are read by the tests only.
pub(super) struct Rehomed {
    /// Every lot's kind, folder and bytes now; the lost ones keep theirs but have no polygon.
    pub lots: Vec<LotInfo>,
    /// Folders of lost houses that took over a filler of their block.
    pub moved: usize,
    /// Folders (of lost houses, and of lost fillers' blocks) left with only their block's polygon,
    /// and the bytes that went with them.
    pub absorbed: usize,
    pub absorbed_bytes: u64,
}

/// Makes up for the lots of `lots` left without a polygon (`area` 0, m²; `block` is each lot's
/// block index). A lost house's folder takes over the biggest surviving filler of its block, whose
/// bytes go to another surviving building of the block; with no filler left the folder's bytes
/// stay with the block's polygon. A lost filler's bytes go to a surviving building of its block,
/// else to the block's polygon. Buildings take bytes in order: fillers, then houses, biggest first.
fn rehome(lots: &[LotInfo], block: &[usize], area: &[f32]) -> Rehomed {
    let mut out = Rehomed {
        lots: lots.to_vec(),
        moved: 0,
        absorbed: 0,
        absorbed_bytes: 0,
    };
    let mut of_block: Vec<Vec<usize>> = Vec::new();
    for (l, &b) in block.iter().enumerate() {
        if b >= of_block.len() {
            of_block.resize(b + 1, Vec::new());
        }
        of_block[b].push(l);
    }
    let biggest = |ids: &mut Vec<usize>| {
        ids.sort_by(|&a, &b| area[b].total_cmp(&area[a]).then(a.cmp(&b)));
    };
    for ids in &of_block {
        let alive = |l: usize, kind| area[l] > 0.0 && lots[l].kind == kind;
        let mut fillers: Vec<usize> = ids
            .iter()
            .copied()
            .filter(|&l| alive(l, LotKind::Filler))
            .collect();
        biggest(&mut fillers);
        let mut lost: Vec<usize> = ids.iter().copied().filter(|&l| area[l] <= 0.0).collect();
        lost.sort_by_key(|&l| (std::cmp::Reverse(lots[l].size), l));
        let mut homeless = 0u64;
        let mut lost_filler = false;
        for &l in &lost {
            match lots[l].kind {
                LotKind::House if !fillers.is_empty() => {
                    let f = fillers.remove(0);
                    homeless += out.lots[f].size;
                    out.lots[f] = lots[l];
                    out.moved += 1;
                }
                LotKind::House => {
                    out.absorbed += 1;
                    out.absorbed_bytes += lots[l].size;
                }
                LotKind::Filler => {
                    homeless += lots[l].size;
                    lost_filler = true;
                }
                _ => {}
            }
        }
        if homeless == 0 {
            continue;
        }
        let mut houses: Vec<usize> = ids
            .iter()
            .copied()
            .filter(|&l| area[l] > 0.0 && out.lots[l].kind == LotKind::House)
            .collect();
        biggest(&mut houses);
        match fillers.first().or(houses.first()) {
            Some(&to) => out.lots[to].size += homeless,
            None => {
                out.absorbed += usize::from(lost_filler);
                out.absorbed_bytes += homeless;
            }
        }
    }
    out
}

/// The lots' polygons, traced within their cells, with every folder and byte kept (see
/// [`rehome`]); a lot cut in pieces has its bytes on its biggest piece.
pub(super) fn lot_polys(blocks: &Blocks, lot: &Grid<i32>) -> (Vec<Poly>, Rehomed) {
    let pieces = outlines(lot, None, CELL, [0.0; 2], Fit::Inside);
    let n = blocks.lots.len();
    let (mut total, mut top) = (vec![0.0f32; n], vec![(0.0f32, usize::MAX); n]);
    for (k, (l, p)) in pieces.iter().enumerate() {
        let (l, a) = (*l as usize, area(p));
        total[l] += a;
        if a > top[l].0 {
            top[l] = (a, k);
        }
    }
    let mut block = vec![0usize; n];
    for (&l, &b) in blocks.lot.data.iter().zip(&blocks.block.data) {
        if l >= 0 && b >= 0 {
            block[l as usize] = b as usize;
        }
    }
    let kept = rehome(&blocks.lots, &block, &total);
    let polys = pieces
        .into_iter()
        .enumerate()
        .map(|(k, (l, p))| {
            let info = kept.lots[l as usize];
            let size = if top[l as usize].1 == k { info.size } else { 0 };
            Poly {
                kind: kind(info.kind),
                id: info.id,
                parent: info.parent,
                size,
                points: p,
            }
        })
        .collect();
    (polys, kept)
}

fn kind(k: LotKind) -> PolyKind {
    match k {
        LotKind::House => PolyKind::House,
        LotKind::Filler => PolyKind::Filler,
        LotKind::Square => PolyKind::Square,
        LotKind::Plaza => PolyKind::Plaza,
        LotKind::Vacant => PolyKind::Vacant,
    }
}
