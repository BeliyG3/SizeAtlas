//! The island's outline (its land with the empty shore) and the canal's water, as polygons.

use super::CELL;
use super::canal::{CANAL_WIDTH, extend, near};
use super::grid::{Grid, close, fill_holes};
use super::path::apart;
use super::shore::Shore;
use super::vector::{Fit, area, outlines};
use std::f32::consts::SQRT_2;

/// The canal's water is drawn this much wider than the canal on each side, so it reaches under
/// the land's straightened edge, metres.
const UNDER_LAND: f32 = CELL;
/// The canal goes on through the shore while there is shore at one of these distances from its
/// axis on both sides, metres (the band keeps 18 m or more off the axis, a little more where it
/// was smoothed).
const BANKS: [f32; 4] = [20.0, 26.0, 32.0, 38.0];
/// The strips beside the canal that are neither water nor shore reach this far from its axis,
/// metres: the outline covers them.
const STRIPS: f32 = 0.5 * CANAL_WIDTH + 8.0;
/// The canal's axis is probed for land and shore every this many metres.
const PROBE: f32 = 3.0;

pub(crate) struct Outline {
    /// The land with its shore, in pieces.
    pub island: Vec<Vec<[f32; 2]>>,
    /// The canal from where it leaves the sea to where it enters it again.
    pub water: Option<Vec<[f32; 2]>>,
    /// Area of the canal's water, m².
    pub water_area: f32,
}

/// The outline of `land` (cells of `CELL` metres) with the band of `shore` around it, and the
/// water of the canal along `axis` (field metres, empty without a canal). On the shore's raster:
/// the land, the band and the strips beside the canal, closed by one cell, without holes.
pub(crate) fn outline(land: &Grid<bool>, shore: &Shore, axis: &[[f32; 2]]) -> Outline {
    let (w, h, cell, origin) = (shore.grid.w, shore.grid.h, shore.cell, shore.origin);
    let fine = (cell / CELL).round() as usize;
    let pad = origin.map(|o| (-o / cell).round() as usize);
    let mut dry = Grid::new(w, h, false);
    for (i, _) in land.data.iter().enumerate().filter(|(_, l)| **l) {
        dry.set(i % land.w / fine + pad[0], i / land.w / fine + pad[1], true);
    }
    let mut foot = Grid {
        data: dry
            .data
            .iter()
            .zip(&shore.grid.data)
            .map(|(&d, &b)| d || b)
            .collect(),
        w,
        h,
    };
    let at = |g: &Grid<bool>, p: [f32; 2]| {
        let (x, y) = (
            ((p[0] - origin[0]) / cell).floor(),
            ((p[1] - origin[1]) / cell).floor(),
        );
        x >= 0.0
            && y >= 0.0
            && (x as usize) < w
            && (y as usize) < h
            && g.get(x as usize, y as usize)
    };
    let (mut water, mut water_area) = (None, 0.0);
    if axis.len() >= 2 {
        let reach = w.max(h) as f32 * cell * SQRT_2;
        let long = extend(axis, reach);
        let inside = |p: [f32; 2], n: [f32; 2]| {
            let side = |k: f32| {
                BANKS
                    .iter()
                    .any(|s| at(&foot, [p[0] + k * s * n[0], p[1] + k * s * n[1]]))
            };
            at(&foot, p) || (side(1.0) && side(-1.0))
        };
        if let Some(canal) = through(&long, |p| at(&dry, p), inside) {
            let strips = near(&canal, w, h, cell, origin, STRIPS);
            for (f, s) in foot.data.iter_mut().zip(&strips.data) {
                *f |= *s;
            }
            water_area = CANAL_WIDTH * length(&canal);
            water = Some(buffer(&canal, 0.5 * CANAL_WIDTH + UNDER_LAND));
        }
    }
    let foot = fill_holes(&close(&foot, 1.0));
    let labels = Grid {
        data: foot.data.iter().map(|&f| if f { 0 } else { -1 }).collect(),
        w,
        h,
    };
    let island = outlines(&labels, Some(0), cell, origin, Fit::Near)
        .into_iter()
        .map(|(_, p)| p)
        .collect();
    Outline {
        island,
        water,
        water_area,
    }
}

/// The stretch of `line` that lies `inside` (given a point and the unit normal there), around
/// the points that are `dry`; `None` when none is.
fn through(
    line: &[[f32; 2]],
    dry: impl Fn([f32; 2]) -> bool,
    inside: impl Fn([f32; 2], [f32; 2]) -> bool,
) -> Option<Vec<[f32; 2]>> {
    let mut probes: Vec<(f32, [f32; 2], [f32; 2])> = Vec::new();
    let mut s0 = 0.0;
    for seg in line.windows(2) {
        let len = apart(seg[0], seg[1]);
        let u = [(seg[1][0] - seg[0][0]) / len, (seg[1][1] - seg[0][1]) / len];
        let n = (len / PROBE).ceil() as usize;
        for k in 0..n {
            let t = k as f32 * PROBE;
            probes.push((
                s0 + t,
                [seg[0][0] + t * u[0], seg[0][1] + t * u[1]],
                [-u[1], u[0]],
            ));
        }
        s0 += len;
    }
    let first = probes.iter().position(|p| dry(p.1))?;
    let last = probes.iter().rposition(|p| dry(p.1))?;
    let mut lo = first;
    while lo > 0 && inside(probes[lo - 1].1, probes[lo - 1].2) {
        lo -= 1;
    }
    let mut hi = last;
    while hi + 1 < probes.len() && inside(probes[hi + 1].1, probes[hi + 1].2) {
        hi += 1;
    }
    Some(cut(
        line,
        probes[lo].0 - 0.5 * PROBE,
        probes[hi].0 + 0.5 * PROBE,
    ))
}

/// The part of `line` between the lengths `from` and `to` along it.
fn cut(line: &[[f32; 2]], from: f32, to: f32) -> Vec<[f32; 2]> {
    let mut out = Vec::new();
    let mut s0 = 0.0;
    for seg in line.windows(2) {
        let len = apart(seg[0], seg[1]);
        let point = |s: f32| {
            let t = ((s - s0) / len).clamp(0.0, 1.0);
            [
                seg[0][0] + t * (seg[1][0] - seg[0][0]),
                seg[0][1] + t * (seg[1][1] - seg[0][1]),
            ]
        };
        if s0 + len > from && s0 < to {
            if out.is_empty() {
                out.push(point(from.max(s0)));
            }
            out.push(point(to.min(s0 + len)));
        }
        s0 += len;
    }
    out
}

fn length(line: &[[f32; 2]]) -> f32 {
    line.windows(2).map(|w| apart(w[0], w[1])).sum()
}

/// The band `r` metres either side of `line`, mitred at its bends and cut square at its ends,
/// with a positive shoelace area (`y` down).
fn buffer(line: &[[f32; 2]], r: f32) -> Vec<[f32; 2]> {
    let normals: Vec<[f32; 2]> = line
        .windows(2)
        .map(|w| {
            let len = apart(w[0], w[1]);
            [-(w[1][1] - w[0][1]) / len, (w[1][0] - w[0][0]) / len]
        })
        .collect();
    let side = |k: f32| -> Vec<[f32; 2]> {
        (0..line.len())
            .map(|i| {
                let (a, b) = (
                    normals[i.saturating_sub(1)],
                    normals[i.min(normals.len() - 1)],
                );
                let m = r * k / (1.0 + a[0] * b[0] + a[1] * b[1]);
                [
                    line[i][0] + m * (a[0] + b[0]),
                    line[i][1] + m * (a[1] + b[1]),
                ]
            })
            .collect()
    };
    let mut poly = side(1.0);
    poly.extend(side(-1.0).into_iter().rev());
    if area(&poly) < 0.0 {
        poly.reverse();
    }
    poly
}
