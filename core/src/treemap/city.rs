//! The city response: the layout of a whole root with the size of every node.
//!
//! Wire format, all little-endian (offsets are repeated in `src/features/city/bytes.ts`):
//! the 24-byte header of [`super::encode`], then `count` records of 32 bytes
//! `f32 x, y, w, h | u32 id | u8 category | u8 depth | u8 is_dir | u8 expanded | u64 size`.
//! `expanded` is 1 for a folder that has at least one laid-out child: a folder cut off by
//! the rectangle budget or by [`super::MIN_SIDE`] has 0 and is drawn as a solid block.

use std::collections::HashSet;

use super::{Rect, header};
use crate::tree::Tree;

pub const CITY_RECORD_LEN: usize = 32;
/// Side of the square field the city is laid out on, in layout units.
pub const CITY_FIELD: f32 = 1000.0;

/// Serializes `rects` (a layout of `tree`) with the size of each node.
pub fn encode_city(
    generation: u64,
    rev: u64,
    approximate: bool,
    rects: &[Rect],
    tree: &Tree,
) -> Vec<u8> {
    let mut out = header(generation, rev, approximate, rects.len(), CITY_RECORD_LEN);
    let parents: HashSet<u32> = rects.iter().map(|r| tree.node(r.id).parent).collect();
    for r in rects {
        for v in [r.x, r.y, r.w, r.h] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.extend_from_slice(&r.id.to_le_bytes());
        let expanded = r.is_dir && parents.contains(&r.id);
        out.extend_from_slice(&[r.category, r.depth, u8::from(r.is_dir), u8::from(expanded)]);
        out.extend_from_slice(&tree.node(r.id).size.to_le_bytes());
    }
    out
}
