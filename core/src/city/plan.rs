//! What an island is built from: the folder summary, its scale and its districts.

use crate::tree::Tree;

/// A folder of the summary. The files right in it take `size - Σ children.size`.
#[derive(Clone, Debug, PartialEq)]
pub struct Folder {
    pub id: u32,
    pub size: u64,
    /// Subfolders, biggest first, without empty ones.
    pub children: Vec<Folder>,
}

impl Folder {
    /// Size of the files right in this folder.
    pub fn files(&self) -> u64 {
        let below: u64 = self.children.iter().map(|c| c.size).sum();
        self.size.saturating_sub(below)
    }
}

/// Everything one island depends on: the same input gives the same island.
#[derive(Clone, Debug, PartialEq)]
pub struct IslandInput {
    pub root: Folder,
    /// Free space of the root's disk, bytes.
    pub free: u64,
    /// Directions from this island to its neighbours, radians.
    pub neighbours: Vec<f32>,
    pub seed: u64,
}

/// The folders down to `depth` levels below `root` (the root is level 0).
pub fn summary(tree: &Tree, root: u32, depth: u8) -> Folder {
    summary_past(tree, root, depth, &[])
}

/// What an island is built from: [`summary`] with two levels below every folder that may
/// become a district, and the folders [`districts`] replaces by their subfolders opened, so the
/// blocks of every district have their houses. Its size is that of a depth-3 summary plus at
/// most `MAX_OPEN` opened folders.
pub fn island_summary(tree: &Tree, root: u32) -> Folder {
    let top = summary(tree, root, 2);
    let mut opened = Vec::new();
    let mut loose = 0;
    // The same choice as `districts` makes on the result: each folder knows its subfolders.
    expand(top.children, &mut loose, |f| {
        opened.push(f.id);
        f.children.iter().map(|c| summary(tree, c.id, 1)).collect()
    });
    summary_past(tree, root, 3, &opened)
}

/// [`summary`] where the folders in `opened` do not count as a level.
fn summary_past(tree: &Tree, root: u32, depth: u8, opened: &[u32]) -> Folder {
    let mut children: Vec<Folder> = if depth == 0 {
        Vec::new()
    } else {
        tree.children(root)
            .filter(|&c| tree.node(c).is_dir() && tree.node(c).size > 0)
            .map(|c| {
                let below = if opened.contains(&c) {
                    depth
                } else {
                    depth - 1
                };
                summary_past(tree, c, below, opened)
            })
            .collect()
    };
    // Stable: equal sizes keep the tree's name order.
    children.sort_by(|a, b| b.size.cmp(&a.size));
    Folder {
        id: root,
        size: tree.node(root).size,
        children,
    }
}

/// Built-up area of an island whose root holds `used` bytes, m².
pub fn built_area(used: u64) -> f32 {
    let gib = used as f64 / f64::from(1u32 << 30);
    (250_000.0 * gib.powf(0.35)).clamp(150_000.0, 1_500_000.0) as f32
}

/// Empty space per built-up square metre: `free / used`, at most 3.
pub fn empty_ratio(used: u64, free: u64) -> f32 {
    if used == 0 {
        return 0.0;
    }
    (free as f64 / used as f64).min(3.0) as f32
}

/// A district of the island: a folder, or the rest of the root.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct District {
    pub id: u32,
    pub size: u64,
    /// Subfolders, they become the district's blocks.
    pub blocks: Vec<Folder>,
    /// Size of the files that lie loose in the district.
    pub files: u64,
}

/// A share above this (of Σ √size) makes a folder a big district.
const BIG: f64 = 0.02;
/// Expand the biggest folder while fewer than this many districts are big.
const WANT_BIG: usize = 8;
/// Folders with a share above this become districts, at most `MAX_DISTRICTS` of them.
const SMALL: f64 = 0.004;
const MAX_DISTRICTS: usize = 14;
/// Replace at most this many folders: past that the folders are alike, and opening more of them
/// makes no big district, only time.
const MAX_OPEN: usize = 32;

fn weight(f: &Folder) -> f64 {
    (f.size.max(1) as f64).sqrt()
}

fn big_count(folders: &[Folder]) -> usize {
    let total: f64 = folders.iter().map(weight).sum();
    folders.iter().filter(|f| weight(f) / total > BIG).count()
}

/// `folders` with the biggest that has subfolders replaced by them (`open`) while fewer than
/// `WANT_BIG` are big, at most `MAX_OPEN` times; the files of the replaced ones go to `loose`.
fn expand(
    mut folders: Vec<Folder>,
    loose: &mut u64,
    mut open: impl FnMut(Folder) -> Vec<Folder>,
) -> Vec<Folder> {
    for _ in 0..MAX_OPEN {
        if big_count(&folders) >= WANT_BIG {
            break;
        }
        let top = folders
            .iter()
            .enumerate()
            .filter(|(_, f)| !f.children.is_empty())
            .max_by(|(i, a), (j, b)| a.size.cmp(&b.size).then(j.cmp(i)))
            .map(|(i, _)| i);
        let Some(top) = top else { break };
        let top = folders.remove(top);
        *loose += top.files();
        folders.extend(open(top));
    }
    folders
}

/// The districts of `root`, biggest (the core) first. The folders left over and every loose file
/// go to one last district with `id = root.id`.
pub(crate) fn districts(root: &Folder) -> Vec<District> {
    let mut loose = root.files();
    let mut folders = expand(root.children.clone(), &mut loose, |f| f.children);
    folders.sort_by(|a, b| b.size.cmp(&a.size));
    let total: f64 = folders.iter().map(weight).sum();
    let picked = folders
        .iter()
        .take(MAX_DISTRICTS)
        .take_while(|f| weight(f) / total > SMALL)
        .count();
    let rest = folders.split_off(picked);
    let mut out: Vec<District> = folders
        .into_iter()
        .map(|f| District {
            id: f.id,
            size: f.size,
            files: f.files(),
            blocks: f.children,
        })
        .collect();
    let size = loose + rest.iter().map(|f| f.size).sum::<u64>();
    if size > 0 || out.is_empty() {
        out.push(District {
            id: root.id,
            size,
            blocks: rest,
            files: loose,
        });
    }
    out
}

#[cfg(test)]
#[path = "plan_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "plan_island_tests.rs"]
mod island_tests;
