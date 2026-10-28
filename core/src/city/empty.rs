//! The empty space inside the city: squares among the lots, plazas and vacant blocks.

use super::CELL;
use super::lots::Cut;
use super::plots::Plot;
use super::rng::Rng;
use std::cmp::Reverse;

/// Share of the lots left open as squares.
const SQUARE: f32 = 0.07;
/// Share of the small filler blocks left open whole as plazas.
const PLAZA: f32 = 0.2;
/// A plaza is a filler block smaller than this (all its cells), m².
const PLAZA_BELOW: f32 = 4_000.0;
/// Chance a block on a pass becomes vacant land while the empty space falls short.
const VACANT: f32 = 0.35;
/// Passes over the blocks for vacant land.
const PASSES: usize = 8;
/// The empty space may overshoot its target by `1 / SLACK` of it.
const SLACK: usize = 20;

/// What a block becomes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Use {
    Built,
    Plaza,
    Vacant,
}

/// The choice so far: each block's use, which lots are squares, and the empty cells.
struct Choice<'a> {
    cuts: &'a [Cut],
    free: &'a [usize],
    /// The lot each kept block keeps built: it holds a folder or its district's last bytes.
    keep: Vec<Option<usize>>,
    uses: Vec<Use>,
    square: Vec<Vec<bool>>,
    empty: usize,
}

/// Picks what of the blocks (with `free` cells off the street room each) stays empty, so the
/// empty cells come to about `target`: plazas and squares by chance, built back at random while
/// they overshoot; then, while it falls short, vacant filler blocks and more squares among
/// their lots. Only fillers go empty whole; a folder's block keeps its biggest lot, and so does
/// one filler of a district with no folder lot, so no folder and no district leaves the map. A
/// target the fillers cannot reach is left short. Returns each block's use and which of its
/// lots are squares.
pub(super) fn choose(
    plots: &[Plot],
    cuts: &[Cut],
    free: &[usize],
    target: usize,
    rng: &mut Rng,
) -> (Vec<Use>, Vec<Vec<bool>>) {
    let n = plots.len();
    let mut c = Choice {
        cuts,
        free,
        keep: kept(plots, cuts),
        uses: vec![Use::Built; n],
        square: cuts.iter().map(|c| vec![false; c.lots.len()]).collect(),
        empty: 0,
    };
    // Picks: a whole block (`None`) or one lot of it.
    let mut picks: Vec<(usize, Option<usize>)> = Vec::new();
    for b in 0..n {
        let small = (plots[b].cells.len() as f32) * CELL * CELL < PLAZA_BELOW;
        if plots[b].filler && small && c.keep[b].is_none() && rng.unit() < PLAZA {
            c.uses[b] = Use::Plaza;
            c.empty += free[b];
            picks.push((b, None));
            continue;
        }
        for (i, lot) in cuts[b].lots.iter().enumerate() {
            if rng.unit() < SQUARE && Some(i) != c.keep[b] {
                c.square[b][i] = true;
                c.empty += lot.len();
                picks.push((b, Some(i)));
            }
        }
    }
    shuffle(&mut picks, rng);
    for (b, lot) in picks {
        if c.empty <= target {
            break;
        }
        match lot {
            None => {
                c.uses[b] = Use::Built;
                c.empty -= free[b];
            }
            Some(i) => {
                c.square[b][i] = false;
                c.empty -= cuts[b].lots[i].len();
            }
        }
    }

    let want = (target, target + target / SLACK);
    let mut fillers: Vec<usize> = (0..n).filter(|&b| plots[b].filler).collect();
    shuffle(&mut fillers, rng);
    c.vacate(&fillers, want, rng);
    c.squares(&fillers, want, rng);
    (c.uses, c.square)
}

impl Choice<'_> {
    /// Passes over the blocks of `order`, each built one turning vacant by chance while the
    /// empty cells fall short of `want.0`, as long as they stay within `want.1`.
    fn vacate(&mut self, order: &[usize], want: (usize, usize), rng: &mut Rng) {
        for _ in 0..PASSES {
            for &b in order {
                let kept = self.keep[b].is_some();
                if kept || self.uses[b] != Use::Built || self.empty >= want.0 {
                    continue;
                }
                let lots = self.cuts[b].lots.iter().zip(&self.square[b]);
                let open: usize = lots.filter(|(_, s)| **s).map(|(l, _)| l.len()).sum();
                let gain = self.free[b] - open;
                if gain > 0 && self.empty + gain <= want.1 && rng.unit() < VACANT {
                    self.uses[b] = Use::Vacant;
                    self.square[b].fill(false);
                    self.empty += gain;
                }
            }
        }
    }

    /// Turns random lots of the built blocks of `order` into squares while the empty cells fall
    /// short of `want.0` (within `want.1`).
    fn squares(&mut self, order: &[usize], want: (usize, usize), rng: &mut Rng) {
        let mut lots: Vec<(usize, usize)> = order
            .iter()
            .filter(|&&b| self.uses[b] == Use::Built)
            .flat_map(|&b| (0..self.cuts[b].lots.len()).map(move |i| (b, i)))
            .filter(|&(b, i)| !self.square[b][i] && Some(i) != self.keep[b])
            .collect();
        shuffle(&mut lots, rng);
        for (b, i) in lots {
            if self.empty + (want.1 - want.0) >= want.0 {
                break;
            }
            let a = self.cuts[b].lots[i].len();
            if self.empty + a <= want.1 {
                self.square[b][i] = true;
                self.empty += a;
            }
        }
    }
}

/// The biggest lot of every folder block, and of the biggest filler block of each district
/// whose folder blocks have no lot.
fn kept(plots: &[Plot], cuts: &[Cut]) -> Vec<Option<usize>> {
    let biggest = |b: usize| {
        let lots = &cuts[b].lots;
        (0..lots.len()).max_by_key(|&i| (lots[i].len(), Reverse(i)))
    };
    let mut keep: Vec<Option<usize>> = (0..plots.len())
        .map(|b| if plots[b].filler { None } else { biggest(b) })
        .collect();
    let districts = plots.iter().map(|p| p.district + 1).max().unwrap_or(0);
    for k in 0..districts {
        let own = || (0..plots.len()).filter(move |&b| plots[b].district == k);
        if own().any(|b| keep[b].is_some()) {
            continue;
        }
        let filler = own()
            .filter(|&b| !cuts[b].lots.is_empty())
            .max_by_key(|&b| (plots[b].cells.len(), Reverse(b)));
        if let Some(b) = filler {
            keep[b] = biggest(b);
        }
    }
    keep
}

fn shuffle<T>(v: &mut [T], rng: &mut Rng) {
    for i in (1..v.len()).rev() {
        v.swap(i, (rng.next_u64() % (i as u64 + 1)) as usize);
    }
}
