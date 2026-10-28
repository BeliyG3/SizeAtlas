//! Streets: the borders between the blocks, and between the blocks and the sea, as octilinear
//! lines from junction to junction.

use super::CELL;
use super::grid::Grid;
use super::path::octilinear;

/// The borders of `labels` (cells of `CELL` metres; outside the grid counts as `-1`) between
/// corners where three or more regions meet, each made octilinear within one cell; a closed
/// border with no such corner comes back to its start. Metres, in the grid's frame.
pub(crate) fn streets(labels: &Grid<i32>) -> Vec<Vec<[f32; 2]>> {
    let b = Borders::new(labels);
    let (cw, ch) = (labels.w + 1, labels.h + 1);
    // `seen[2 * corner + 0]`: the side going right from the corner; `+ 1`: the one going down.
    let mut seen = vec![false; 2 * cw * ch];
    let mut out = Vec::new();
    let junction = |x: usize, y: usize| {
        let d = b.sides(x, y).iter().filter(|s| s.is_some()).count();
        d > 0 && d != 2
    };
    for pass in 0..2 {
        for y in 0..ch {
            for x in 0..cw {
                // First every border from a junction, then the closed ones left.
                if pass == 0 && !junction(x, y) {
                    continue;
                }
                for side in b.sides(x, y).into_iter().flatten() {
                    if seen[side.0] {
                        continue;
                    }
                    let corners = walk(&b, &mut seen, (x, y), side, &junction);
                    out.push(octilinear(&turns(&corners), CELL));
                }
            }
        }
    }
    out
}

/// A cell side: its index in `seen` and the corner it leads to.
type Side = (usize, (usize, usize));

struct Borders<'a> {
    labels: &'a Grid<i32>,
}

impl Borders<'_> {
    fn new(labels: &Grid<i32>) -> Borders<'_> {
        Borders { labels }
    }

    fn at(&self, x: isize, y: isize) -> i32 {
        let l = self.labels;
        if x < 0 || y < 0 || x >= l.w as isize || y >= l.h as isize {
            -1
        } else {
            l.data[y as usize * l.w + x as usize]
        }
    }

    /// The border sides at corner `(x, y)`: right, left, down, up.
    fn sides(&self, x: usize, y: usize) -> [Option<Side>; 4] {
        let cw = self.labels.w + 1;
        let (xi, yi) = (x as isize, y as isize);
        let id = |cx: usize, cy: usize, down: usize| 2 * (cy * cw + cx) + down;
        let (r, l, d, u) = (
            self.at(xi, yi - 1) != self.at(xi, yi),
            self.at(xi - 1, yi - 1) != self.at(xi - 1, yi),
            self.at(xi - 1, yi) != self.at(xi, yi),
            self.at(xi - 1, yi - 1) != self.at(xi, yi - 1),
        );
        [
            (r && x + 1 < cw).then(|| (id(x, y, 0), (x + 1, y))),
            (l && x > 0).then(|| (id(x - 1, y, 0), (x - 1, y))),
            (d && y < self.labels.h).then(|| (id(x, y, 1), (x, y + 1))),
            (u && y > 0).then(|| (id(x, y - 1, 1), (x, y - 1))),
        ]
    }
}

/// The corners of the border that leaves `from` by `first`, up to the next junction (or back to
/// `from`), marking its sides seen.
fn walk(
    b: &Borders,
    seen: &mut [bool],
    from: (usize, usize),
    first: Side,
    junction: &impl Fn(usize, usize) -> bool,
) -> Vec<(usize, usize)> {
    let mut corners = vec![from];
    let mut side = first;
    loop {
        seen[side.0] = true;
        let at = side.1;
        corners.push(at);
        if at == from || junction(at.0, at.1) {
            return corners;
        }
        match b
            .sides(at.0, at.1)
            .into_iter()
            .flatten()
            .find(|s| !seen[s.0])
        {
            Some(next) => side = next,
            None => return corners,
        }
    }
}

/// The corners where the border turns, both ends kept, in metres.
fn turns(corners: &[(usize, usize)]) -> Vec<[f32; 2]> {
    let mut out: Vec<[f32; 2]> = Vec::with_capacity(corners.len());
    for (i, &(x, y)) in corners.iter().enumerate() {
        let straight = i > 0 && i + 1 < corners.len() && {
            let (p, n) = (corners[i - 1], corners[i + 1]);
            (p.0 == x && n.0 == x) || (p.1 == y && n.1 == y)
        };
        if !straight {
            out.push([x as f32 * CELL, y as f32 * CELL]);
        }
    }
    out
}
