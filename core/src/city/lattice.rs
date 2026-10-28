//! Exact integer geometry of octilinear segments: points on a lattice of `1 / UNIT` metres,
//! lines at 0, 45, 90 and 135 degrees, and the snapping of polylines onto lines of a 0.25 m
//! lattice.

/// A point in lattice units.
pub(crate) type P = [i64; 2];

/// Lattice units per metre: fine enough that every crossing of the snapped lines, and every
/// connector the merge adds, lands on the lattice exactly.
pub(crate) const UNIT: f32 = 64.0;
/// Lines are snapped to pass through points of this lattice, units (0.25 m: the middles of the
/// cells and of the lanes lie on it, so they do not move).
const SNAP: i64 = 16;

/// The 8 directions, `k · 45°` with `y` down.
const DIRS: [P; 8] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
];

pub(crate) fn units(p: [f32; 2]) -> P {
    [(p[0] * UNIT).round() as i64, (p[1] * UNIT).round() as i64]
}

pub(crate) fn metres(p: P) -> [f32; 2] {
    [p[0] as f32 / UNIT, p[1] as f32 / UNIT]
}

/// The direction index and the number of unit steps from `a` to `b`, if `b - a` is octilinear
/// and not zero.
pub(crate) fn dir(a: P, b: P) -> Option<(usize, i64)> {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    if (dx, dy) == (0, 0) || !(dx == 0 || dy == 0 || dx.abs() == dy.abs()) {
        return None;
    }
    let k = DIRS.iter().position(|d| *d == [dx.signum(), dy.signum()])?;
    Some((k, dx.abs().max(dy.abs())))
}

/// Unit step of direction `k`.
pub(crate) fn step(k: usize) -> P {
    DIRS[k % 8]
}

/// The direction (index) nearest to the vector `d`.
fn nearest_dir(d: [f32; 2]) -> usize {
    let k = (d[1].atan2(d[0]) / std::f32::consts::FRAC_PI_4).round() as i64;
    k.rem_euclid(8) as usize
}

/// A line `n · p = c` of family `f` (0: along x, 1: along (1, 1), 2: along y, 3: along (-1, 1)).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Line {
    pub f: u8,
    pub c: i64,
}

const NORMALS: [P; 4] = [[0, 1], [1, -1], [1, 0], [1, 1]];

impl Line {
    /// The line through `p` along direction `k`.
    pub fn through(p: P, k: usize) -> Self {
        let f = (k % 4) as u8;
        let n = NORMALS[f as usize];
        Self {
            f,
            c: n[0] * p[0] + n[1] * p[1],
        }
    }

    /// Position along the line: `x` for the families 0 and 1, `y` for 2 and 3; one unit of it is
    /// one step of the family's direction.
    pub fn t(self, p: P) -> i64 {
        if self.f < 2 { p[0] } else { p[1] }
    }

    /// The point of the line at position `t`.
    pub fn at(self, t: i64) -> P {
        match self.f {
            0 => [t, self.c],
            1 => [t, t - self.c],
            2 => [self.c, t],
            _ => [self.c - t, t],
        }
    }

    /// Metres per unit of `t`.
    pub fn scale(self) -> f32 {
        if self.f % 2 == 1 {
            std::f32::consts::SQRT_2 / UNIT
        } else {
            1.0 / UNIT
        }
    }

    /// Distance between this line and a parallel one, metres.
    pub fn apart(self, other: Line) -> f32 {
        let d = (self.c - other.c).abs() as f32 / UNIT;
        if self.f % 2 == 1 {
            d / std::f32::consts::SQRT_2
        } else {
            d
        }
    }

    /// Where two lines of different families cross, rounded to the lattice (exact for the
    /// lines this module makes).
    pub fn cross(self, other: Line) -> Option<P> {
        if self.f == other.f {
            return None;
        }
        let (n1, n2) = (NORMALS[self.f as usize], NORMALS[other.f as usize]);
        let det = n1[0] * n2[1] - n1[1] * n2[0];
        let x = self.c * n2[1] - n1[1] * other.c;
        let y = n1[0] * other.c - self.c * n2[0];
        Some([div_round(x, det), div_round(y, det)])
    }
}

fn div_round(a: i64, b: i64) -> i64 {
    let (a, b) = if b < 0 { (-a, -b) } else { (a, b) };
    (2 * a + b).div_euclid(2 * b)
}

fn round_to(v: i64, m: i64) -> i64 {
    div_round(v, m) * m
}

/// `line` (octilinear, metres) moved onto the lattice: every segment onto the nearest parallel
/// line through points of the 0.25 m lattice, every inner vertex where its two lines cross, the
/// ends onto their lines. The result depends only on each segment's own position, so polylines
/// that share a stretch share it exactly after snapping too. Parallel neighbours that land on
/// different lines get a short connector at 0 or 90 degrees.
pub(crate) fn snap_line(line: &[[f32; 2]]) -> Vec<P> {
    let pts: Vec<[f32; 2]> =
        line.iter()
            .copied()
            .fold(Vec::with_capacity(line.len()), |mut v, p| {
                if v.last()
                    .is_none_or(|q: &[f32; 2]| (p[0] - q[0]).hypot(p[1] - q[1]) > 1e-3)
                {
                    v.push(p);
                }
                v
            });
    if pts.len() < 2 {
        return pts.iter().map(|&p| units(p)).collect();
    }
    let lines: Vec<Line> = pts
        .windows(2)
        .map(|w| {
            let k = nearest_dir([w[1][0] - w[0][0], w[1][1] - w[0][1]]);
            let l = Line::through(units(w[0]), k);
            Line {
                c: round_to(l.c, SNAP),
                ..l
            }
        })
        .collect();
    let on = |l: Line, p: [f32; 2]| l.at(l.t(units(p)));
    let mut out = vec![on(lines[0], pts[0])];
    for i in 1..lines.len() {
        let (a, b) = (lines[i - 1], lines[i]);
        match a.cross(b) {
            Some(p) => out.push(p),
            None => {
                out.push(on(a, pts[i]));
                if a.c != b.c {
                    out.push(on(b, pts[i]));
                }
            }
        }
    }
    out.push(on(lines[lines.len() - 1], pts[pts.len() - 1]));
    out.dedup();
    out
}
