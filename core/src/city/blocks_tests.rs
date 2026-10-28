use super::*;
use crate::city::land::{land, seeds};
use crate::city::plan::{Folder, districts};
use crate::city::voronoi::voronoi;

/// Built-up area of the test islands, m².
const BUILT: f32 = 300_000.0;

/// A folder with up to `fan[0]` subfolders, each with up to `fan[1]`, and so on; sizes spread
/// over a few orders of magnitude.
fn folder(rng: &mut Rng, next: &mut u32, fan: &[usize]) -> Folder {
    let id = *next;
    *next += 1;
    let n = fan.first().map_or(0, |&f| (rng.unit() * f as f32) as usize);
    let mut children: Vec<Folder> = (0..n).map(|_| folder(rng, next, &fan[1..])).collect();
    children.sort_by(|a, b| b.size.cmp(&a.size));
    let files = (1e9 * rng.unit().powi(3)) as u64 + 1;
    let size = files + children.iter().map(|c| c.size).sum::<u64>();
    Folder { id, size, children }
}

fn root(seed: u64) -> Folder {
    let mut rng = Rng::new(seed);
    let mut next = 0;
    let mut root = folder(&mut rng, &mut next, &[0]);
    root.children = (0..12)
        .map(|_| folder(&mut rng, &mut next, &[40, 8]))
        .collect();
    root.children.sort_by(|a, b| b.size.cmp(&a.size));
    root.size = root.files() + root.children.iter().map(|c| c.size).sum::<u64>();
    root
}

struct City {
    districts: Vec<District>,
    land: Grid<bool>,
    blocks: Blocks,
}

fn city(inner_empty: f32, seed: u64) -> City {
    let districts = districts(&root(seed));
    let mut rng = Rng::new(seed);
    let mut at = seeds(districts.len(), &mut rng);
    let weights: Vec<f32> = districts
        .iter()
        .map(|d| (d.size.max(1) as f32).sqrt())
        .collect();
    let sum: f32 = weights.iter().sum();
    let areas: Vec<f32> = weights
        .iter()
        .map(|w| w / sum * (BUILT + inner_empty))
        .collect();
    let land = land(&areas, &mut at, 50.0, &mut rng);
    let cells = land.data.iter().filter(|&&l| l).count() as f32 * CELL * CELL;
    let targets: Vec<f32> = weights.iter().map(|w| w / sum * cells).collect();
    let dist = voronoi(&land, &at, &targets, 0.0, 50);
    let blocks = blocks(&districts, &land, &dist, inner_empty, &mut rng);
    City {
        districts,
        land,
        blocks,
    }
}

/// Cells of every lot.
fn lot_cells(b: &Blocks) -> Vec<Vec<usize>> {
    let mut out = vec![Vec::new(); b.lots.len()];
    for (i, &l) in b.lot.data.iter().enumerate() {
        if l >= 0 {
            out[l as usize].push(i);
        }
    }
    out
}

/// The block frame's coordinates of cell `i`, metres.
fn frame(c: &City, block: i32, i: usize) -> [f32; 2] {
    let district = c.blocks.block_info[block as usize].1;
    let k = c.districts.iter().position(|d| d.id == district).unwrap();
    let (cos, sin) = (c.blocks.rot[k].cos(), c.blocks.rot[k].sin());
    let w = c.land.w;
    let (x, y) = (((i % w) as f32 + 0.5) * CELL, ((i / w) as f32 + 0.5) * CELL);
    [x * cos + y * sin, y * cos - x * sin]
}

fn empty_area(b: &Blocks) -> f32 {
    let mut area = 0.0;
    for &l in &b.lot.data {
        if l >= 0
            && matches!(
                b.lots[l as usize].kind,
                LotKind::Square | LotKind::Plaza | LotKind::Vacant
            )
        {
            area += CELL * CELL;
        }
    }
    area
}

#[test]
fn every_lot_lies_in_one_block() {
    let c = city(40_000.0, 1);
    let b = &c.blocks;
    assert!(b.lots.len() > 100, "{} lots", b.lots.len());
    for (l, cells) in lot_cells(b).iter().enumerate() {
        assert!(!cells.is_empty(), "lot {l} has no cell");
        let first = b.block.data[cells[0]];
        assert!(first >= 0, "lot {l} off the blocks");
        assert!(cells.iter().all(|&i| b.block.data[i] == first), "lot {l}");
        assert!(c.land.data[cells[0]]);
    }
}

#[test]
fn streets_separate_blocks() {
    for seed in [2, 12] {
        let c = city(40_000.0, seed);
        streets_between_blocks(&c.blocks);
    }
}

fn streets_between_blocks(b: &Blocks) {
    let w = b.lot.w as i64;
    let reach = ((10.0 + CELL) / CELL).ceil() as i64;
    for (i, &l) in b.lot.data.iter().enumerate() {
        if l < 0 {
            continue;
        }
        let (x, y) = (i as i64 % w, i as i64 / w);
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                let (nx, ny) = (x + dx, y + dy);
                if nx < 0 || ny < 0 || nx >= w || ny >= b.lot.h as i64 {
                    continue;
                }
                let j = (ny * w + nx) as usize;
                if b.lot.data[j] < 0 || b.block.data[j] == b.block.data[i] {
                    continue;
                }
                // Gap between the two cells' squares.
                let (gx, gy) = ((dx.abs() - 1).max(0), (dy.abs() - 1).max(0));
                let gap = ((gx * gx + gy * gy) as f32).sqrt() * CELL;
                assert!(gap >= 10.0 - 1e-3, "cells {i} and {j}: {gap} m");
            }
        }
    }
}

/// Whether a cell of `cells` (all in block `block`) lies within `reach` cells of another block or
/// off the blocks: the lot reaches its block's edge, where the street room trims it.
fn at_block_edge(b: &Blocks, block: i32, cells: &[usize], reach: i64) -> bool {
    let w = b.block.w as i64;
    cells.iter().any(|&i| {
        let (x, y) = (i as i64 % w, i as i64 / w);
        (-reach..=reach).any(|dy| {
            (-reach..=reach).any(|dx| {
                let (nx, ny) = (x + dx, y + dy);
                nx < 0
                    || ny < 0
                    || nx >= w
                    || ny >= b.block.h as i64
                    || b.block.data[(ny * w + nx) as usize] != block
            })
        })
    })
}

#[test]
fn lots_are_18_to_40_m_or_cut_by_the_block_edge() {
    let c = city(40_000.0, 3);
    let b = &c.blocks;
    // Lots keep this far from a border; a lot this close to another block was trimmed by it.
    let reach = ((5.5 + 2.0 * CELL) / CELL).ceil() as i64;
    let mut sides = Vec::new();
    let mut short = Vec::new();
    for (l, cells) in lot_cells(b).iter().enumerate() {
        if b.lots[l].kind != LotKind::House {
            continue;
        }
        let block = b.block.data[cells[0]];
        let (mut lo, mut hi) = ([f32::INFINITY; 2], [f32::NEG_INFINITY; 2]);
        for &i in cells {
            let p = frame(&c, block, i);
            for a in 0..2 {
                lo[a] = lo[a].min(p[a]);
                hi[a] = hi[a].max(p[a]);
            }
        }
        // Cell centres span one cell less than the lot.
        let side = (hi[0] - lo[0]).max(hi[1] - lo[1]) + CELL;
        sides.push(side);
        if side < 18.0 - 1e-3 && !at_block_edge(b, block, cells, reach) {
            short.push((l, side));
        }
    }
    assert!(sides.len() > 50, "{} houses", sides.len());
    let fit = sides.iter().filter(|&&s| s <= 40.0 + CELL).count();
    assert!(
        fit as f32 >= 0.9 * sides.len() as f32,
        "{fit} of {}",
        sides.len()
    );
    sides.sort_by(f32::total_cmp);
    let median = sides[sides.len() / 2];
    assert!(median >= 18.0, "median {median} m");
    assert!(
        short.is_empty(),
        "short houses inside their blocks: {short:?}"
    );
}

#[test]
fn biggest_subfolders_get_the_biggest_lots() {
    let c = city(40_000.0, 4);
    let b = &c.blocks;
    let cells = lot_cells(b);
    let mut per_block: Vec<Vec<usize>> = vec![Vec::new(); b.block_info.len()];
    for (l, cs) in cells.iter().enumerate() {
        per_block[b.block.data[cs[0]] as usize].push(l);
    }
    let mut checked = 0;
    for (k, lots) in per_block.iter().enumerate() {
        let mut houses: Vec<usize> = lots
            .iter()
            .copied()
            .filter(|&l| b.lots[l].kind == LotKind::House)
            .collect();
        houses.sort_by_key(|&l| Reverse(b.lots[l].size));
        for pair in houses.windows(2) {
            assert!(cells[pair[0]].len() >= cells[pair[1]].len(), "block {k}");
        }
        let smallest = houses.last().map_or(0, |&l| cells[l].len());
        for &l in lots {
            if b.lots[l].kind == LotKind::Filler && !houses.is_empty() {
                assert!(cells[l].len() <= smallest, "block {k}: filler {l}");
            }
            if b.lots[l].kind == LotKind::House {
                assert_eq!(b.lots[l].parent, b.block_info[k].0);
            }
        }
        checked += usize::from(houses.len() > 1);
    }
    assert!(checked > 10, "{checked} blocks with houses");
}

#[test]
fn the_empty_inside_reaches_its_target() {
    for (target, seed) in [(20_000.0, 5), (60_000.0, 6), (150_000.0, 7)] {
        let got = empty_area(&city(target, seed).blocks);
        assert!(
            (got - target).abs() <= 0.1 * target,
            "{target}: {got} m² empty"
        );
    }
    let c = city(0.0, 8);
    assert!(c.blocks.lots.iter().all(|l| l.kind != LotKind::Vacant));
    let land = c.land.data.iter().filter(|&&l| l).count() as f32 * CELL * CELL;
    assert!(empty_area(&c.blocks) <= 0.03 * land);
}

#[test]
fn lanes_are_octilinear_and_inside_their_block() {
    let c = city(40_000.0, 9);
    let b = &c.blocks;
    assert!(b.lanes.len() > 50, "{} lanes", b.lanes.len());
    let blocks_near = |p: [f32; 2]| {
        let (x, y) = ((p[0] / CELL) as i64, (p[1] / CELL) as i64);
        let mut out = Vec::new();
        for dy in -1..=1 {
            for dx in -1..=1 {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && ny >= 0 && (nx as usize) < b.block.w && (ny as usize) < b.block.h {
                    out.push(b.block.get(nx as usize, ny as usize));
                }
            }
        }
        out
    };
    for &(p, q, width) in &b.lanes {
        assert!(width == 5.0 || width == 3.0, "{width}");
        let angle = (q[1] - p[1]).atan2(q[0] - p[0]);
        let step = std::f32::consts::FRAC_PI_4;
        let off = (angle / step - (angle / step).round()).abs() * step;
        assert!(off < 1e-3, "{p:?} {q:?}");
        let mut shared = blocks_near(p);
        for t in 1..=10 {
            let t = t as f32 / 10.0;
            let s = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
            let here = blocks_near(s);
            shared.retain(|l| *l >= 0 && here.contains(l));
        }
        assert!(!shared.is_empty(), "lane {p:?} {q:?} leaves its block");
    }
}

#[test]
fn deterministic() {
    assert_eq!(city(30_000.0, 10).blocks, city(30_000.0, 10).blocks);
}

/// Bytes the lots hold, as a share of the districts' bytes.
fn held_share(c: &City) -> f64 {
    let total: u64 = c.districts.iter().map(|d| d.size).sum();
    let held: u64 = c.blocks.lots.iter().map(|l| l.size).sum();
    assert!(held <= total, "{held} of {total}");
    held as f64 / total as f64
}

#[test]
fn lots_hold_the_bytes_of_their_districts() {
    for (inner_empty, seed) in [(0.0, 11), (60_000.0, 12)] {
        let share = held_share(&city(inner_empty, seed));
        assert!(share >= 0.999, "{inner_empty}: {share}");
    }
}

#[test]
fn no_folder_leaves_the_map() {
    // Half the land meant to stay empty is more than the fillers can give; seed 30 has a
    // district too small for any lot.
    for (inner_empty, seed) in [(300_000.0, 13), (300_000.0, 30), (20_000.0, 30)] {
        let c = city(inner_empty, seed);
        let share = held_share(&c);
        assert!(share >= 0.999, "{inner_empty}/{seed}: {share}");
        let b = &c.blocks;
        let mut on_map = std::collections::BTreeSet::new();
        let mut built = std::collections::BTreeSet::new();
        for (l, cells) in lot_cells(b).iter().enumerate() {
            built.insert(b.block_info[b.block.data[cells[0]] as usize].1);
            match b.lots[l].kind {
                LotKind::House => on_map.insert(b.lots[l].id),
                LotKind::Filler => on_map.insert(b.lots[l].parent),
                _ => false,
            };
        }
        let mut folders = 0;
        // A district with no lot at all is narrower than its streets: nothing can stand there.
        for d in c.districts.iter().filter(|d| built.contains(&d.id)) {
            for f in d.blocks.iter().take(28) {
                folders += 1;
                assert!(
                    on_map.contains(&f.id),
                    "{seed}: folder {} of {}",
                    f.id,
                    d.id
                );
            }
        }
        assert!(folders > 100, "{folders} folders");
        let vacant = b.lots.iter().any(|l| l.kind == LotKind::Vacant);
        assert!(vacant || inner_empty < 100_000.0);
    }
}
