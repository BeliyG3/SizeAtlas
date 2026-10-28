//! Splitting each district into blocks by a weighted Voronoi in the district's frame.

use super::CELL;
use super::grid::Grid;
use super::plan::{District, Folder};
use super::rng::Rng;
use super::voronoi::voronoi_sampled;

/// A district's subfolders past this many give no block of their own.
const MAX_FOLDER_BLOCKS: usize = 28;
/// Filler blocks are added until the mean block is about this big, m².
const BLOCK_AREA: f32 = 12_000.0;
/// Rounds of the blocks' weight fit.
const ROUNDS: usize = 20;
/// Cells per block the weights are fitted on.
const FIT_CELLS: usize = 100;
/// Share of a block left to its lots once the street room is taken, roughly.
const FREE: f32 = 0.6;
/// At most this share of the land is given to the fillers meant to stay empty.
const MAX_OPEN: f32 = 0.9;

/// A block before it is cut.
pub(super) struct Plot<'a> {
    pub id: u32,
    pub district: usize,
    /// Bytes; a filler's share of its district's loose bytes is set once the empty blocks are
    /// known.
    pub size: u64,
    /// No folder of its own: it holds what is left of its district.
    pub filler: bool,
    /// The folder's subfolders, biggest first; they become its houses.
    pub children: &'a [Folder],
    pub cells: Vec<u32>,
}

/// The blocks of every district (`land` labelled `dist`, by index into `districts`), turned by
/// `rot`: one per subfolder (up to `MAX_FOLDER_BLOCKS`, weight `size^0.35`) and fillers for the
/// rest of it. The district's share of `inner_empty` gets filler blocks of its own, so the empty
/// space can be taken from fillers and the folders keep their houses. Returns the block index
/// per cell, the blocks, and each district's loose bytes (what no folder block holds).
pub(super) fn plots<'a>(
    districts: &'a [District],
    land: &Grid<bool>,
    dist: &Grid<i32>,
    rot: &[f32],
    inner_empty: f32,
    rng: &mut Rng,
) -> (Grid<i32>, Vec<Plot<'a>>, Vec<u64>) {
    let w = dist.w;
    let mut cells = vec![Vec::new(); districts.len()];
    for (i, (&d, &l)) in dist.data.iter().zip(&land.data).enumerate() {
        if l && d >= 0 && (d as usize) < districts.len() {
            cells[d as usize].push(i as u32);
        }
    }
    let land_area = cells.iter().map(Vec::len).sum::<usize>() as f32 * CELL * CELL;
    // The streets take a share of every block: the open fillers are sized for what is left.
    let open = (inner_empty / FREE / land_area.max(1.0)).clamp(0.0, MAX_OPEN);
    let mut block = Grid::new(w, dist.h, -1);
    let mut plots: Vec<Plot> = Vec::new();
    let mut loose = vec![0; districts.len()];
    for (k, (d, own)) in districts.iter().zip(&cells).enumerate() {
        if own.is_empty() {
            continue;
        }
        let area = own.len() as f32 * CELL * CELL;
        let built = area * (1.0 - open);
        let folders = &d.blocks[..d.blocks.len().min(MAX_FOLDER_BLOCKS)];
        let mut weights: Vec<f32> = folders
            .iter()
            .map(|f| (f.size.max(1) as f32).powf(0.35))
            .collect();
        let least = weights.iter().copied().fold(f32::INFINITY, f32::min);
        let least = if least.is_finite() { least } else { 1.0 };
        let left = d.size.saturating_sub(folders.iter().map(|f| f.size).sum());
        let fillers = ((built / BLOCK_AREA) as usize)
            .saturating_sub(folders.len())
            .max(usize::from(folders.is_empty() || left > 0));
        weights.extend((0..fillers).map(|_| least * rng.range(0.6, 1.4)));
        let total: f32 = weights.iter().sum();
        let mut targets: Vec<f32> = weights.iter().map(|v| v / total * built).collect();
        let spare = area - built;
        let extra = (spare / BLOCK_AREA).ceil() as usize;
        targets.extend((0..extra).map(|_| spare / extra as f32 * rng.range(0.6, 1.4)));

        // The district's own crop of the field, seeds in its metres.
        let (x0, y0) = own.iter().fold((usize::MAX, usize::MAX), |(x, y), &i| {
            (x.min(i as usize % w), y.min(i as usize / w))
        });
        let (x1, y1) = own.iter().fold((0, 0), |(x, y), &i| {
            (x.max(i as usize % w), y.max(i as usize / w))
        });
        let mut mask = Grid::new(x1 - x0 + 1, y1 - y0 + 1, false);
        let local: Vec<usize> = own
            .iter()
            .map(|&i| mask.idx(i as usize % w - x0, i as usize / w - y0))
            .collect();
        for &j in &local {
            mask.data[j] = true;
        }
        let seeds = spread(&local, mask.w, &targets, rng);
        targets.truncate(seeds.len());
        let total: f32 = targets.iter().sum();
        for t in &mut targets {
            *t *= area / total;
        }
        let fit = FIT_CELLS * seeds.len();
        let labels = voronoi_sampled(&mask, &seeds, &targets, rot[k], ROUNDS, fit);

        let base = plots.len();
        let kept = targets.len().min(folders.len());
        for f in &folders[..kept] {
            plots.push(plot(f.id, k, f.size, false, &f.children));
        }
        for _ in kept..targets.len() {
            plots.push(plot(d.id, k, 0, true, &[]));
        }
        loose[k] = d
            .size
            .saturating_sub(folders[..kept].iter().map(|f| f.size).sum());
        for (&i, &j) in own.iter().zip(&local) {
            let l = labels.data[j];
            if l >= 0 {
                block.data[i as usize] = (base + l as usize) as i32;
                plots[base + l as usize].cells.push(i);
            }
        }
    }
    (block, plots, loose)
}

fn plot(id: u32, district: usize, size: u64, filler: bool, children: &[Folder]) -> Plot<'_> {
    Plot {
        id,
        district,
        size,
        filler,
        children,
        cells: Vec::new(),
    }
}

/// Seeds for the blocks of `targets` (m²) among the cells `local` of a grid `w` wide, metres:
/// biggest block first, each the farthest from the blocks before it (Chebyshev distance less
/// half their side), among `6 n` cells picked at random. A district of fewer cells than that
/// gets seeds for the first blocks only.
fn spread(local: &[usize], w: usize, targets: &[f32], rng: &mut Rng) -> Vec<[f32; 2]> {
    let n = targets.len();
    let mut picked: Vec<usize> = Vec::with_capacity(6 * n);
    for _ in 0..6 * n {
        let j = local[(rng.next_u64() % local.len() as u64) as usize];
        if !picked.contains(&j) {
            picked.push(j);
        }
    }
    let at = |j: usize| [((j % w) as f32 + 0.5) * CELL, ((j / w) as f32 + 0.5) * CELL];
    let cand: Vec<[f32; 2]> = picked.into_iter().map(at).collect();
    let mut order: Vec<usize> = (0..n.min(cand.len())).collect();
    order.sort_by(|&a, &b| targets[b].total_cmp(&targets[a]));
    let mut out = vec![[0.0; 2]; order.len()];
    let mut near = vec![f32::INFINITY; cand.len()];
    let mut next = 0;
    for &i in &order {
        let p = cand[next];
        out[i] = p;
        let half = 0.5 * targets[i].max(0.0).sqrt();
        for (d, c) in near.iter_mut().zip(&cand) {
            *d = d.min((c[0] - p[0]).abs().max((c[1] - p[1]).abs()) - half);
        }
        near[next] = f32::NEG_INFINITY;
        next = (0..cand.len()).fold(0, |b, i| if near[i] > near[b] { i } else { b });
    }
    out
}
