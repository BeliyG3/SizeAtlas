//! Placing the planned lots on the field. Every lot keeps the smallest side of its depth;
//! an expanded lot whose children cannot all keep theirs is emitted as a building instead.

use std::collections::VecDeque;

use super::{Lot, LotKind, Planned, inset, min_side};
use crate::treemap::{Area, squarify};

/// Rounds of widening lots that came out too narrow before their parent is given up.
const ROUNDS: usize = 16;
/// Room for float error when comparing a side with its minimum.
const SLACK: f64 = 1e-6;

/// Places the planned lots level by level on a `side × side` field, parents first.
pub(super) fn place(plan: &[Planned], side: f32) -> Vec<Lot> {
    let field = Area {
        x: 0.0,
        y: 0.0,
        w: f64::from(side),
        h: f64::from(side),
    };
    let mut lots: Vec<Lot> = Vec::with_capacity(plan.len() - 1);
    // A planned lot, its interior, and its own place in `lots` (none for the root).
    let mut queue = VecDeque::from([(0, field, None::<usize>)]);
    while let Some((parent, inner, own)) = queue.pop_front() {
        let kids = &plan[parent].children;
        if kids.is_empty() {
            continue;
        }
        let min = min_side(plan[kids[0]].depth);
        let placed = match (fit(plan, kids, inner, min), own) {
            (Some(placed), _) => placed,
            (None, Some(own)) => {
                lots[own].kind = LotKind::Building;
                continue;
            }
            // ponytail: the root cannot become a building, so it falls back to plain
            // proportional areas; its at most 26 lots on a field of 400 m or more fit anyway.
            (None, None) => fit(plan, kids, inner, 0.0).unwrap_or_default(),
        };
        for (&k, a) in kids.iter().zip(placed) {
            let p = &plan[k];
            lots.push(Lot {
                x: a.x as f32,
                y: a.y as f32,
                w: a.w as f32,
                h: a.h as f32,
                id: p.id,
                kind: p.kind,
                depth: p.depth,
                size: p.size,
            });
            if !p.children.is_empty() {
                let inner = shrink(a, f64::from(inset(p.depth)));
                queue.push_back((k, inner, Some(lots.len() - 1)));
            }
        }
    }
    lots
}

/// Rectangles for `kids`, in their order, filling `inner` with both sides at least `min`;
/// none if they do not fit. Squarify only keeps areas, so a lot that comes out narrower
/// than `min` gets a larger minimum area and the layout is tried again.
fn fit(plan: &[Planned], kids: &[usize], inner: Area, min: f64) -> Option<Vec<Area>> {
    if inner.w < min || inner.h < min {
        return None;
    }
    let sizes: Vec<f64> = kids.iter().map(|&k| plan[k].size as f64).collect();
    let mut mins = vec![min * min; kids.len()];
    for _ in 0..ROUNDS {
        let areas = fill(&sizes, &mins, inner.w * inner.h)?;
        let placed = squarified(&areas, inner);
        let mut fits = true;
        for ((least, &area), a) in mins.iter_mut().zip(&areas).zip(&placed) {
            let short = a.w.min(a.h);
            if short < min - SLACK {
                *least = area * min / short;
                fits = false;
            }
        }
        if fits {
            return Some(placed);
        }
    }
    None
}

/// Water-filling: lots whose share of `room` by size falls below their minimum area get
/// that minimum, the others share what is left by size, until no share falls short.
/// None if the minimums alone do not fit.
fn fill(sizes: &[f64], mins: &[f64], room: f64) -> Option<Vec<f64>> {
    if mins.iter().sum::<f64>() > room {
        return None;
    }
    let mut fixed = vec![false; sizes.len()];
    loop {
        let (mut left, mut free) = (room, 0.0);
        for ((&size, &least), &fixed) in sizes.iter().zip(mins).zip(&fixed) {
            if fixed {
                left -= least;
            } else {
                free += size;
            }
        }
        let areas: Vec<f64> = (0..sizes.len())
            .map(|i| {
                if fixed[i] {
                    mins[i]
                } else {
                    sizes[i] / free * left
                }
            })
            .collect();
        let mut settled = true;
        for (i, &area) in areas.iter().enumerate() {
            if !fixed[i] && area < mins[i] {
                fixed[i] = true;
                settled = false;
            }
        }
        if settled {
            return Some(areas);
        }
    }
}

/// [`squarify`] of `areas` in any order: they are laid out largest first and the
/// rectangles come back in the order of `areas`.
fn squarified(areas: &[f64], inner: Area) -> Vec<Area> {
    let mut order: Vec<usize> = (0..areas.len()).collect();
    order.sort_by(|&a, &b| areas[b].total_cmp(&areas[a]));
    let sorted: Vec<f64> = order.iter().map(|&i| areas[i]).collect();
    let mut placed = Vec::with_capacity(areas.len());
    squarify(&sorted, inner, &mut placed);
    let mut out = vec![inner; areas.len()];
    for (&i, a) in order.iter().zip(placed) {
        out[i] = a;
    }
    out
}

fn shrink(a: Area, by: f64) -> Area {
    Area {
        x: a.x + by,
        y: a.y + by,
        w: (a.w - 2.0 * by).max(0.0),
        h: (a.h - 2.0 * by).max(0.0),
    }
}

#[cfg(test)]
#[path = "place_tests.rs"]
mod tests;
