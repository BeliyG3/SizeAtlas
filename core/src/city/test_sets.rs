//! Synthetic archipelagos for the tests: islands of power-law roots, built by the first pass
//! (gates facing where `directions` foresees the others) or the second (facing where `place`
//! put them).

use super::archipelago::{bearings, place_on_rays};
use super::map::Island;
use super::plan::{Folder, IslandInput};
use super::rng::Rng;
use super::{directions, island};
use std::f32::consts::FRAC_PI_2;
use std::sync::OnceLock;

const GIB: u64 = 1 << 30;
/// Free space over used space, island by island (cycled).
const RATIOS: [f64; 5] = [0.5, 1.5, 0.2, 3.0, 0.8];

/// A root of `used` bytes (give or take rounding): 8 folders of 2 to 8 subfolders, which weigh
/// `u^-1.5` for a uniform `u` (a power law).
fn root(seed: u64, used: u64) -> Folder {
    let mut rng = Rng::new(seed);
    let weights: Vec<Vec<f64>> = (0..8)
        .map(|_| {
            let n = 2 + (rng.unit() * 7.0) as usize;
            (0..n)
                .map(|_| f64::from(rng.unit().max(1e-3)).powf(-1.5))
                .collect()
        })
        .collect();
    let unit = used as f64 / weights.iter().flatten().sum::<f64>();
    let mut next = 0;
    let mut folder = |size: u64, mut children: Vec<Folder>| {
        next += 1;
        children.sort_by(|a, b| b.size.cmp(&a.size));
        Folder {
            id: next,
            size,
            children,
        }
    };
    let mut children = Vec::new();
    for leaves in weights {
        let kids: Vec<Folder> = (leaves.iter())
            .map(|w| folder((w * unit) as u64 + 1, Vec::new()))
            .collect();
        let size = kids.iter().map(|k| k.size).sum();
        children.push(folder(size, kids));
    }
    let size = children.iter().map(|c| c.size).sum::<u64>() + 1;
    folder(size, children)
}

const ONE: [u64; 1] = [2 * GIB];
const THREE: [u64; 3] = [4 * GIB, 2 * GIB, GIB];
/// From 2 TiB down to 1 GiB.
const FOUR: [u64; 4] = [2048 * GIB, 64 * GIB, 8 * GIB, GIB];
const FIVE: [u64; 5] = [16 * GIB, 8 * GIB, 4 * GIB, 2 * GIB, GIB];

/// Islands of about `used` bytes each, biggest first, the gates of the `i`-th facing
/// `aim(sizes, i)` (`(used, free)` of every island); built side by side.
fn build(used: &[u64], aim: impl Fn(&[(u64, u64)], usize) -> Vec<f32>) -> Vec<Island> {
    let roots: Vec<Folder> = (used.iter().enumerate())
        .map(|(i, &u)| root(i as u64 + 1, u))
        .collect();
    assert!(roots.windows(2).all(|w| w[0].size > w[1].size));
    let sizes: Vec<(u64, u64)> = (roots.iter().enumerate())
        .map(|(i, r)| (r.size, (r.size as f64 * RATIOS[i % RATIOS.len()]) as u64))
        .collect();
    std::thread::scope(|s| {
        let builds: Vec<_> = (roots.iter().enumerate())
            .map(|(i, r)| {
                let input = IslandInput {
                    root: r.clone(),
                    free: sizes[i].1,
                    neighbours: aim(&sizes, i),
                    seed: i as u64 + 1,
                };
                s.spawn(move || island(&input))
            })
            .collect();
        builds.into_iter().map(|b| b.join().unwrap()).collect()
    })
}

/// The first pass: the gates face the others by [`directions`].
fn archipelago(used: &[u64]) -> Vec<Island> {
    build(used, directions)
}

/// The second pass: the islands of `first` built again, their gates facing where `place` put
/// the others.
fn second(used: &[u64], first: &[Island]) -> Vec<Island> {
    let refs: Vec<&Island> = first.iter().collect();
    let aims = bearings(&refs, &place_on_rays(&refs));
    build(used, |_, i| aims[i].clone())
}

pub(crate) fn one() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| archipelago(&ONE))
}

pub(crate) fn three() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| archipelago(&THREE))
}

pub(crate) fn four() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| archipelago(&FOUR))
}

pub(crate) fn five() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| archipelago(&FIVE))
}

pub(crate) fn three_real() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| second(&THREE, three()))
}

pub(crate) fn four_real() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| second(&FOUR, four()))
}

pub(crate) fn five_real() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| second(&FIVE, five()))
}

/// From 256 GiB halving down to 2 GiB.
pub(crate) fn eight() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| archipelago(&(0..8).map(|i| (256 * GIB) >> i).collect::<Vec<_>>()))
}

/// The four built by a first pass that foresaw every direction a quarter turn off.
pub(crate) fn four_turned() -> &'static [Island] {
    static SET: OnceLock<Vec<Island>> = OnceLock::new();
    SET.get_or_init(|| {
        let turned = |sizes: &[(u64, u64)], i: usize| {
            (directions(sizes, i).into_iter())
                .map(|a| a + FRAC_PI_2)
                .collect()
        };
        build(&FOUR, turned)
    })
}
