//! Road classes, their widths, and a straight road segment on the lattice.

use super::lattice::{Line, P, dir};

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum RoadClass {
    Highway = 0,
    Ring = 1,
    Ramp = 2,
    Street = 3,
    Lane = 4,
}

impl RoadClass {
    /// A highway, the ring or a ramp: the roads that turn by 45° at most.
    pub fn overpass(self) -> bool {
        matches!(self, Self::Highway | Self::Ring | Self::Ramp)
    }
}

/// Full width of a road of class `c`, metres.
pub fn road_width(c: RoadClass) -> f32 {
    match c {
        RoadClass::Highway | RoadClass::Ring | RoadClass::Ramp => 16.0,
        RoadClass::Street => 10.0,
        RoadClass::Lane => 5.0,
    }
}

/// A straight, octilinear piece of road from `a` to `b` (lattice units).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Seg {
    pub a: P,
    pub b: P,
    pub class: RoadClass,
}

impl Seg {
    /// Direction index and length in steps; `None` for a point or a skew piece.
    pub fn dir(&self) -> Option<(usize, i64)> {
        dir(self.a, self.b)
    }

    pub fn line(&self) -> Line {
        Line::through(self.a, self.dir().map_or(0, |(k, _)| k))
    }

    /// The span of the segment along its line, low end first.
    pub fn span(&self) -> (i64, i64) {
        let l = self.line();
        let (p, q) = (l.t(self.a), l.t(self.b));
        (p.min(q), p.max(q))
    }

    pub fn len(&self) -> f32 {
        let (lo, hi) = self.span();
        (hi - lo) as f32 * self.line().scale()
    }
}
