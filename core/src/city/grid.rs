//! Raster grid and its binary morphology.
//!
//! Cell `(x, y)` is centred at `((x + 0.5) * CELL, (y + 0.5) * CELL)` metres.

/// Row-major raster. `data[y * w + x]`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Grid<T> {
    pub w: usize,
    pub h: usize,
    pub data: Vec<T>,
}

impl<T: Copy> Grid<T> {
    pub fn new(w: usize, h: usize, fill: T) -> Self {
        Self {
            w,
            h,
            data: vec![fill; w * h],
        }
    }

    #[inline]
    pub fn idx(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    #[inline]
    pub fn get(&self, x: usize, y: usize) -> T {
        self.data[self.idx(x, y)]
    }

    #[inline]
    pub fn set(&mut self, x: usize, y: usize, v: T) {
        let i = self.idx(x, y);
        self.data[i] = v;
    }
}

/// Scratch buffers for the 1-D squared distance transform (one set per call, no per-line allocation).
struct Line {
    f: Vec<f64>,
    out: Vec<f64>,
    arg: Vec<usize>,
    v: Vec<usize>,
    z: Vec<f64>,
}

impl Line {
    fn new(n: usize) -> Self {
        Self {
            f: vec![0.0; n],
            out: vec![0.0; n],
            arg: vec![0; n],
            v: Vec::with_capacity(n),
            z: Vec::with_capacity(n),
        }
    }

    /// Lower envelope of the parabolas `(q - p)^2 + f[p]` over `p < n` (Felzenszwalb-Huttenlocher).
    /// Infinite `f[p]` are skipped; if all are infinite the output is infinite.
    fn transform(&mut self, n: usize) {
        let (f, v, z) = (&self.f, &mut self.v, &mut self.z);
        v.clear();
        z.clear();
        for q in 0..n {
            if !f[q].is_finite() {
                continue;
            }
            loop {
                let Some(&p) = v.last() else {
                    v.push(q);
                    z.push(f64::NEG_INFINITY);
                    break;
                };
                let (pf, qf) = (p as f64, q as f64);
                let s = ((f[q] + qf * qf) - (f[p] + pf * pf)) / (2.0 * (qf - pf));
                if s <= z[z.len() - 1] {
                    v.pop();
                    z.pop();
                } else {
                    v.push(q);
                    z.push(s);
                    break;
                }
            }
        }
        if v.is_empty() {
            self.out[..n].fill(f64::INFINITY);
            return;
        }
        let mut k = 0;
        for q in 0..n {
            while k + 1 < v.len() && z[k + 1] < q as f64 {
                k += 1;
            }
            let d = q as f64 - v[k] as f64;
            self.out[q] = d * d + f[v[k]];
            self.arg[q] = v[k];
        }
    }
}

/// Exact Euclidean distance (in cells) from every cell to the nearest `true` cell, and that
/// cell's index. `true` cells get 0 and their own index; with no `true` cell at all the result is
/// `f32::INFINITY` and `u32::MAX`.
pub(crate) fn distance(mask: &Grid<bool>) -> (Grid<f32>, Grid<u32>) {
    let (w, h) = (mask.w, mask.h);
    let mut dist = Grid::new(w, h, f32::INFINITY);
    let mut near = Grid::new(w, h, u32::MAX);
    let mut line = Line::new(w.max(h));
    // Pass 1, columns: `dist` holds the squared vertical distance, `near` the source row.
    for x in 0..w {
        for y in 0..h {
            line.f[y] = if mask.data[y * w + x] {
                0.0
            } else {
                f64::INFINITY
            };
        }
        line.transform(h);
        for y in 0..h {
            dist.data[y * w + x] = line.out[y] as f32;
            near.data[y * w + x] = line.arg[y] as u32;
        }
    }
    // Pass 2, rows: combine with the horizontal offset.
    let mut src_row = vec![0u32; w];
    for y in 0..h {
        for (f, &d) in line.f.iter_mut().zip(&dist.data[y * w..(y + 1) * w]) {
            *f = f64::from(d);
        }
        src_row.copy_from_slice(&near.data[y * w..(y + 1) * w]);
        line.transform(w);
        for x in 0..w {
            let i = y * w + x;
            if line.out[x].is_finite() {
                let p = line.arg[x];
                dist.data[i] = line.out[x].sqrt() as f32;
                near.data[i] = src_row[p] * w as u32 + p as u32;
            } else {
                dist.data[i] = f32::INFINITY;
                near.data[i] = u32::MAX;
            }
        }
    }
    (dist, near)
}

fn from_fn(w: usize, h: usize, data: impl Iterator<Item = bool>) -> Grid<bool> {
    Grid {
        w,
        h,
        data: data.collect(),
    }
}

/// Cells within `r` cells of a `true` cell.
pub(crate) fn dilate(m: &Grid<bool>, r: f32) -> Grid<bool> {
    let (d, _) = distance(m);
    from_fn(m.w, m.h, d.data.iter().map(|&d| d <= r))
}

/// Cells farther than `r` cells from every `false` cell. The outside of the grid counts as
/// neither, so `true` runs are not eaten from the grid edge.
pub(crate) fn erode(m: &Grid<bool>, r: f32) -> Grid<bool> {
    let inverted = from_fn(m.w, m.h, m.data.iter().map(|&b| !b));
    let (d, _) = distance(&inverted);
    from_fn(m.w, m.h, d.data.iter().map(|&d| d > r))
}

/// Erode then dilate: removes specks and spurs thinner than `2 r`.
pub(crate) fn open(m: &Grid<bool>, r: f32) -> Grid<bool> {
    dilate(&erode(m, r), r)
}

/// Dilate then erode: fills gaps and notches narrower than `2 r`.
pub(crate) fn close(m: &Grid<bool>, r: f32) -> Grid<bool> {
    erode(&dilate(m, r), r)
}

/// Opening by the cells within `steps` 4-neighbour steps (the same as [`open`] with `r = steps`
/// for `steps <= 2`), without distance transforms. The outside of the grid counts as `true` while
/// eroding and `false` while dilating, as in [`erode`] and [`dilate`].
pub(crate) fn open_steps(m: &Grid<bool>, steps: usize) -> Grid<bool> {
    let mut cur = m.clone();
    for grow in [false, true] {
        for _ in 0..steps {
            cur = cross(&cur, grow);
        }
    }
    cur
}

/// One 4-neighbour step: erosion (`grow == false`) or dilation (`grow == true`).
fn cross(m: &Grid<bool>, grow: bool) -> Grid<bool> {
    let (w, h) = (m.w, m.h);
    let mut out = m.clone();
    let at = |x: usize, y: usize| m.data[y * w + x];
    for y in 0..h {
        for x in 0..w {
            let around = [
                x > 0 && at(x - 1, y) == grow,
                x + 1 < w && at(x + 1, y) == grow,
                y > 0 && at(x, y - 1) == grow,
                y + 1 < h && at(x, y + 1) == grow,
            ];
            // Eroding, a `false` neighbour clears the cell; dilating, a `true` one sets it.
            if around.contains(&true) {
                out.data[y * w + x] = grow;
            }
        }
    }
    out
}

/// Fills every `false` region that cannot reach the grid edge through 8-connected `false` cells
/// (the pairing that goes with the 4-connected components of [`label`]).
pub(crate) fn fill_holes(m: &Grid<bool>) -> Grid<bool> {
    let (w, h) = (m.w, m.h);
    if w == 0 || h == 0 {
        return m.clone();
    }
    let mut outside = vec![false; w * h];
    let mut stack: Vec<usize> = Vec::new();
    let mut visit = |i: usize, stack: &mut Vec<usize>| {
        if !m.data[i] && !outside[i] {
            outside[i] = true;
            stack.push(i);
        }
    };
    for x in 0..w {
        visit(x, &mut stack);
        visit((h - 1) * w + x, &mut stack);
    }
    for y in 0..h {
        visit(y * w, &mut stack);
        visit(y * w + w - 1, &mut stack);
    }
    while let Some(i) = stack.pop() {
        let (x, y) = (i % w, i / w);
        for ny in y.saturating_sub(1)..=(y + 1).min(h - 1) {
            for nx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                visit(ny * w + nx, &mut stack);
            }
        }
    }
    from_fn(w, h, outside.iter().map(|&o| !o))
}

/// 4-connected components of the `true` cells: labels `0..count`, background `-1`.
pub(crate) fn label(m: &Grid<bool>) -> (Grid<i32>, usize) {
    let (w, h) = (m.w, m.h);
    let mut labels = Grid::new(w, h, -1i32);
    let mut count = 0usize;
    let mut stack: Vec<usize> = Vec::new();
    for start in 0..w * h {
        if !m.data[start] || labels.data[start] >= 0 {
            continue;
        }
        labels.data[start] = count as i32;
        stack.push(start);
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            let around = [
                (x > 0).then(|| i - 1),
                (x + 1 < w).then(|| i + 1),
                (y > 0).then(|| i - w),
                (y + 1 < h).then(|| i + w),
            ];
            for n in around.into_iter().flatten() {
                if m.data[n] && labels.data[n] < 0 {
                    labels.data[n] = count as i32;
                    stack.push(n);
                }
            }
        }
        count += 1;
    }
    (labels, count)
}

/// Cells whose right or bottom neighbour carries a different label.
pub(crate) fn borders(labels: &Grid<i32>) -> Grid<bool> {
    let (w, h) = (labels.w, labels.h);
    let mut out = Grid::new(w, h, false);
    for y in 0..h {
        for x in 0..w {
            let l = labels.data[y * w + x];
            let right = x + 1 < w && labels.data[y * w + x + 1] != l;
            let below = y + 1 < h && labels.data[(y + 1) * w + x] != l;
            out.data[y * w + x] = right || below;
        }
    }
    out
}

#[cfg(test)]
#[path = "grid_tests.rs"]
mod tests;
