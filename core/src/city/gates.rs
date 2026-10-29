//! Gates towards the neighbouring islands: the straight at a highway's shore end, and the ramps
//! from its junction onto the other highways.

use super::CELL;
use super::grid::Grid;
use super::net::{Line, Net};
use super::path::{apart, corners, point_line, point_segment};
use std::f32::consts::FRAC_PI_4;

/// Length of a gate's straight, metres.
pub(crate) const GATE: f32 = 90.0;
/// A junction ramps onto this share of the other highways, rounded up.
const RAMP_SHARE: f32 = 0.5;
/// A ramp ends at least this far from its own highway, metres (a highway's width).
const APART: f32 = 16.0;
/// Two gates' straights keep this far apart, metres (two highways' width).
const GATE_GAP: f32 = 32.0;
/// A point this close to a line lies on it, metres.
const ON: f32 = 1e-2;

/// The gate facing `a` (radians): its shore end, its junction and its outward direction, the
/// multiple of 45° nearest to `a`. The straight lies on the land for `GATE` metres back from the
/// land edge (less only where the land has no such run), the core reaches its junction, it keeps
/// `GATE_GAP` from the straights `taken` (shore end, junction), and of all such straights its
/// shore end lies the farthest along `a` from `core`.
pub(crate) fn gate(
    land: &Grid<bool>,
    net: &Net,
    core: [f32; 2],
    a: f32,
    taken: &[([f32; 2], [f32; 2])],
) -> Option<([f32; 2], [f32; 2], [f32; 2])> {
    let k = (a / FRAC_PI_4).round() * FRAC_PI_4;
    let s = (k.cos().round() as isize, k.sin().round() as isize);
    let step = [s.0 as f32 * CELL, s.1 as f32 * CELL];
    let size = step[0].hypot(step[1]);
    let out = [step[0] / size, step[1] / size];
    let d = [a.cos(), a.sin()];
    // Land cells a straight needs behind its last one.
    let need = (GATE / size + 0.5).ceil() as isize;
    let (w, h) = (land.w as isize, land.h as isize);
    let dry =
        |x: isize, y: isize| x >= 0 && y >= 0 && x < w && y < h && land.data[(y * w + x) as usize];
    let (mut best, mut best_key) = (None, (f32::NEG_INFINITY, f32::NEG_INFINITY));
    for i in 0..land.data.len() {
        let (x, y) = ((i % land.w) as isize, (i / land.w) as isize);
        // Only the last land cell before the edge along `s` ends a straight.
        if !land.data[i] || dry(x + s.0, y + s.1) {
            continue;
        }
        let n = (1..need)
            .take_while(|&k| dry(x - k * s.0, y - k * s.1))
            .count() as f32
            + 1.0;
        let shore = [
            (x as f32 + 0.5) * CELL + 0.5 * step[0],
            (y as f32 + 0.5) * CELL + 0.5 * step[1],
        ];
        let straight = ((n - 0.5) * size).min(GATE);
        let key = (
            straight,
            (shore[0] - core[0]) * d[0] + (shore[1] - core[1]) * d[1],
        );
        if key <= best_key {
            continue;
        }
        let junction = [shore[0] - straight * out[0], shore[1] - straight * out[1]];
        let clear = taken
            .iter()
            .all(|&(s, j)| segments_apart(shore, junction, s, j) >= GATE_GAP);
        if clear && net.cell(junction).is_some() {
            (best, best_key) = (Some((shore, junction, out)), key);
        }
    }
    best
}

/// The ramps from the junction of gate line `g` (its second point) until they reach the nearest
/// `RAMP_SHARE` of the other `lines`. Each ends at the point of its highway nearest to the
/// junction that lies `APART` from line `g`, and reaches every highway through that point (where
/// highways run together).
pub(crate) fn ramps(land: &Grid<bool>, net: &Net, lines: &[Line], g: usize) -> Vec<Line> {
    let (own, junction) = (&lines[g], lines[g][1]);
    let want = (RAMP_SHARE * lines.len().saturating_sub(1) as f32).ceil() as usize;
    let mut near: Vec<(f32, [f32; 2], usize)> = lines
        .iter()
        .enumerate()
        .filter(|&(h, _)| h != g)
        .filter_map(|(h, line)| {
            samples(line)
                .filter(|&p| point_line(p, own) >= APART)
                .map(|p| (apart(p, junction), p, h))
                .min_by(|p, q| p.0.total_cmp(&q.0))
        })
        .collect();
    near.sort_by(|p, q| p.0.total_cmp(&q.0));
    let mut reached = vec![false; lines.len()];
    let mut out = Vec::new();
    for (_, p, h) in near {
        if reached.iter().filter(|&&r| r).count() >= want {
            break;
        }
        if reached[h] {
            continue;
        }
        reached[h] = true;
        for (l, line) in lines.iter().enumerate() {
            reached[l] |= l != g && point_line(p, line) < ON;
        }
        out.push(ramp(land, net, junction, p));
    }
    out
}

/// Straight, then 45°, from `a` to `b`; over the land's cheapest way when that leaves the land.
fn ramp(land: &Grid<bool>, net: &Net, a: [f32; 2], b: [f32; 2]) -> Line {
    let c = corners(a, b)[0];
    let mut line = vec![a];
    if apart(c, a) > ON && apart(c, b) > ON {
        line.push(c);
    }
    line.push(b);
    if samples(&line).all(|p| on_land(land, p)) {
        return line;
    }
    net.detour(a, b).unwrap_or(line)
}

/// Distance between the segments `a`-`b` and `c`-`d`.
pub(crate) fn segments_apart(a: [f32; 2], b: [f32; 2], c: [f32; 2], d: [f32; 2]) -> f32 {
    let cross = |o: [f32; 2], p: [f32; 2], q: [f32; 2]| {
        (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    };
    if cross(a, b, c) * cross(a, b, d) < 0.0 && cross(c, d, a) * cross(c, d, b) < 0.0 {
        return 0.0;
    }
    let ends = [(a, c, d), (b, c, d), (c, a, b), (d, a, b)];
    ends.iter()
        .map(|&(p, s, e)| point_segment(p, s, e))
        .fold(f32::INFINITY, f32::min)
}

/// Points every half cell along `line`, its vertices included.
fn samples(line: &[[f32; 2]]) -> impl Iterator<Item = [f32; 2]> + '_ {
    line.windows(2).flat_map(|w| {
        let n = (apart(w[0], w[1]) / (0.5 * CELL)).ceil().max(1.0) as usize;
        (0..=n).map(move |t| {
            let t = t as f32 / n as f32;
            [
                w[0][0] + t * (w[1][0] - w[0][0]),
                w[0][1] + t * (w[1][1] - w[0][1]),
            ]
        })
    })
}

fn on_land(land: &Grid<bool>, p: [f32; 2]) -> bool {
    let (x, y) = ((p[0] / CELL).floor(), (p[1] / CELL).floor());
    x >= 0.0
        && y >= 0.0
        && (x as usize) < land.w
        && (y as usize) < land.h
        && land.get(x as usize, y as usize)
}
