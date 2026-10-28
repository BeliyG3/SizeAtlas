//! Squarified treemap of a subtree for a canvas of `width × height` CSS pixels, and its
//! compact encoding for the UI.
//!
//! Wire format, all little-endian (offsets are repeated in `src/features/treemap/bytes.ts`):
//! a 24-byte header `u64 generation | u64 rev | u32 count | u8 approximate | 3 × u8 padding`,
//! then `count` records of 24 bytes `f32 x, y, w, h | u32 id | u8 category | u8 depth |
//! u8 is_dir | u8 padding`. Parents always come before their children.

use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;

use crate::tree::Tree;

mod city;
pub use city::{
    ALLEY, CITY_FORMAT, CITY_HEADER_LEN, CITY_RECORD_LEN, HIGHWAY, Lot, LotKind, MAX_BUILDINGS,
    MAX_CHILDREN, MIN_BLOCK, MIN_BUILDING, SIDEWALK, STREET, city_layout, city_layout_with,
    encode_city, field_side, inset,
};

pub const HEADER_LEN: usize = 24;
pub const RECORD_LEN: usize = 24;
/// Rectangle budget of one response: plenty of detail, about 480 KB.
pub const MAX_RECTS: usize = 20_000;
/// Rectangles narrower or lower than this many CSS pixels are not drawn.
pub const MIN_SIDE: f32 = 2.0;
/// Gap between a folder's edge and its contents, so nesting stays visible.
const PADDING: f64 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub id: u32,
    pub category: u8,
    /// 0 for the children of the laid-out node.
    pub depth: u8,
    pub is_dir: bool,
}

#[derive(Clone, Copy, Debug)]
struct Area {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// A folder whose children are still to be laid out; larger areas are expanded first.
struct Pending {
    area: Area,
    id: u32,
    depth: u8,
}

impl Pending {
    fn size(&self) -> f64 {
        self.area.w * self.area.h
    }
}

impl Ord for Pending {
    fn cmp(&self, other: &Self) -> Ordering {
        self.size()
            .total_cmp(&other.size())
            .then(other.id.cmp(&self.id))
    }
}

impl PartialOrd for Pending {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Pending {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Pending {}

/// Lays out the subtree of `root` (its children at depth 0) on a `width × height` canvas.
/// Folders are expanded largest first until `max_rects` rectangles are placed, so a huge
/// tree keeps its biggest parts; items smaller than [`MIN_SIDE`] are left out.
/// A file `root` fills the whole canvas.
pub fn layout(tree: &Tree, root: u32, width: f32, height: f32, max_rects: usize) -> Vec<Rect> {
    let mut rects = Vec::new();
    // Written so that NaN fails the check.
    if !(width >= MIN_SIDE && height >= MIN_SIDE) || max_rects == 0 {
        return rects;
    }
    let canvas = Area {
        x: 0.0,
        y: 0.0,
        w: f64::from(width),
        h: f64::from(height),
    };
    if !tree.node(root).is_dir() {
        rects.push(rect(tree, root, canvas, 0));
        return rects;
    }
    let min_side = f64::from(MIN_SIDE);
    let mut pending = BinaryHeap::from([Pending {
        area: canvas,
        id: root,
        depth: 0,
    }]);
    let mut items: Vec<u32> = Vec::new();
    let mut areas: Vec<f64> = Vec::new();
    let mut placed: Vec<Area> = Vec::new();
    while let Some(dir) = pending.pop() {
        items.clear();
        items.extend(tree.children(dir.id).filter(|&c| tree.node(c).size > 0));
        items.sort_unstable_by_key(|&c| (Reverse(tree.node(c).size), c));
        let total: f64 = items.iter().map(|&c| tree.node(c).size as f64).sum();
        if total == 0.0 {
            continue;
        }
        let scale = dir.size() / total;
        let area_of = |c: u32| tree.node(c).size as f64 * scale;
        // Children are sorted by size, so the ones too small to draw form a tail. The tail
        // keeps its space as one undrawn block instead of being laid out item by item.
        let shown = items
            .iter()
            .take_while(|&&c| area_of(c) >= min_side * min_side)
            .count();
        areas.clear();
        areas.extend(items[..shown].iter().map(|&c| area_of(c)));
        let tail: f64 = items[shown..].iter().map(|&c| area_of(c)).sum();
        if tail > 0.0 {
            areas.push(tail);
        }
        placed.clear();
        squarify(&areas, dir.area, &mut placed);
        for (&child, &area) in items[..shown].iter().zip(&placed) {
            if area.w < min_side || area.h < min_side {
                continue;
            }
            if rects.len() == max_rects {
                return rects;
            }
            rects.push(rect(tree, child, area, dir.depth));
            let inner = Area {
                x: area.x + PADDING,
                y: area.y + PADDING,
                w: area.w - 2.0 * PADDING,
                h: area.h - 2.0 * PADDING,
            };
            if tree.node(child).is_dir() && inner.w >= min_side && inner.h >= min_side {
                pending.push(Pending {
                    area: inner,
                    id: child,
                    depth: dir.depth.saturating_add(1),
                });
            }
        }
    }
    rects
}

fn rect(tree: &Tree, id: u32, a: Area, depth: u8) -> Rect {
    let node = tree.node(id);
    Rect {
        x: a.x as f32,
        y: a.y as f32,
        w: a.w as f32,
        h: a.h as f32,
        id,
        category: node.category,
        depth,
        is_dir: node.is_dir(),
    }
}

/// Worst aspect ratio of a strip holding areas with this sum, minimum and maximum
/// along a side of length `side`.
fn worst(sum: f64, min: f64, max: f64, side: f64) -> f64 {
    let (sum2, side2) = (sum * sum, side * side);
    f64::max(side2 * max / sum2, sum2 / (side2 * min))
}

/// Squarified layout (Bruls, Huizing, van Wijk) of positive `areas`, sorted largest first,
/// into `r`; pushes one rectangle per area in the same order.
fn squarify(areas: &[f64], mut r: Area, out: &mut Vec<Area>) {
    let mut i = 0;
    while i < areas.len() {
        let side = r.w.min(r.h);
        let (mut sum, mut min, mut max) = (areas[i], areas[i], areas[i]);
        let mut end = i + 1;
        while end < areas.len() {
            let a = areas[end];
            let next = (sum + a, min.min(a), max.max(a));
            if worst(next.0, next.1, next.2, side) > worst(sum, min, max, side) {
                break;
            }
            (sum, min, max) = next;
            end += 1;
        }
        if r.w >= r.h {
            // A column along the left edge.
            let thickness = if r.h > 0.0 { sum / r.h } else { 0.0 };
            let mut y = r.y;
            for &a in &areas[i..end] {
                let h = if thickness > 0.0 { a / thickness } else { 0.0 };
                out.push(Area {
                    x: r.x,
                    y,
                    w: thickness,
                    h,
                });
                y += h;
            }
            r.x += thickness;
            r.w = (r.w - thickness).max(0.0);
        } else {
            // A row along the top edge.
            let thickness = if r.w > 0.0 { sum / r.w } else { 0.0 };
            let mut x = r.x;
            for &a in &areas[i..end] {
                let w = if thickness > 0.0 { a / thickness } else { 0.0 };
                out.push(Area {
                    x,
                    y: r.y,
                    w,
                    h: thickness,
                });
                x += w;
            }
            r.y += thickness;
            r.h = (r.h - thickness).max(0.0);
        }
        i = end;
    }
}

/// The 24-byte header shared by the treemap and the city responses; the buffer has room
/// for `count` records of `record_len` bytes.
fn header(
    generation: u64,
    rev: u64,
    approximate: bool,
    count: usize,
    record_len: usize,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_LEN + count * record_len);
    out.extend_from_slice(&generation.to_le_bytes());
    out.extend_from_slice(&rev.to_le_bytes());
    out.extend_from_slice(&(count as u32).to_le_bytes());
    out.extend_from_slice(&[u8::from(approximate), 0, 0, 0]);
    out
}

/// Serializes rectangles in the wire format described in the module docs.
pub fn encode(generation: u64, rev: u64, approximate: bool, rects: &[Rect]) -> Vec<u8> {
    let mut out = header(generation, rev, approximate, rects.len(), RECORD_LEN);
    for r in rects {
        for v in [r.x, r.y, r.w, r.h] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.extend_from_slice(&r.id.to_le_bytes());
        out.extend_from_slice(&[r.category, r.depth, u8::from(r.is_dir), 0]);
    }
    out
}

#[cfg(test)]
mod tests;
