//! The ring: the outline of the core district.

use super::CELL;
use super::grid::{Grid, label};
use super::net::{Line, STEP};
use super::path::octilinear;
use std::cmp::Reverse;

/// The outline of the core's main piece (district 0 of `dist`; the piece under `core`, metres,
/// else the biggest one), closed and octilinear; `None` without a core.
pub(crate) fn ring(dist: &Grid<i32>, core: [f32; 2]) -> Option<Line> {
    let mask = Grid {
        data: dist.data.iter().map(|&l| l == 0).collect(),
        w: dist.w,
        h: dist.h,
    };
    let (labels, count) = label(&mask);
    let (sx, sy) = ((core[0] / CELL) as usize, (core[1] / CELL) as usize);
    let main = match (sx < labels.w && sy < labels.h).then(|| labels.get(sx, sy)) {
        Some(l) if l >= 0 => l,
        _ => {
            let mut size = vec![0usize; count];
            for &l in labels.data.iter().filter(|&&l| l >= 0) {
                size[l as usize] += 1;
            }
            (0..count).max_by_key(|&i| (size[i], Reverse(i)))? as i32
        }
    };
    let (w, h) = (labels.w as isize, labels.h as isize);
    let ours = |(x, y): (isize, isize)| {
        x >= 0 && y >= 0 && x < w && y < h && labels.data[(y * w + x) as usize] == main
    };
    // The cell on the right (`k = 1`, `y` down) or on the left (`k = -1`) of the cell side that
    // leaves corner `v` along `d`.
    let side = |v: (isize, isize), d: (isize, isize), k: isize| {
        let half = |c: isize, s: isize| if s > 0 { c } else { c - 1 };
        (half(v.0, d.0 - k * d.1), half(v.1, d.1 + k * d.0))
    };
    let edge = |v, d| ours(side(v, d, 1)) && !ours(side(v, d, -1));
    // The top side of the piece's first cell lies on its outline; walk it with the piece on the
    // right, turning right first so two cells touching at a corner stay apart.
    let first = labels.data.iter().position(|&l| l == main)?;
    let start = ((first % labels.w) as isize, (first / labels.w) as isize);
    let (mut v, mut d) = (start, (1isize, 0isize));
    let mut outline = vec![[start.0 as f32 * CELL, start.1 as f32 * CELL]];
    loop {
        v = (v.0 + d.0, v.1 + d.1);
        outline.push([v.0 as f32 * CELL, v.1 as f32 * CELL]);
        d = [(-d.1, d.0), d, (d.1, -d.0)]
            .into_iter()
            .find(|&n| edge(v, n))?;
        if v == start && d == (1, 0) {
            break;
        }
    }
    Some(octilinear(&outline, STEP))
}
