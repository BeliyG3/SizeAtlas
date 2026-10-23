//! Info spots, found by path from the root rather than by the walk, so a never place does not
//! hide them.

use super::paths::{components, fits};
use super::{Context, Info, Os, Spot, SpotKind};
use crate::tree::{NO_PARENT, Tree, flags};

pub(crate) fn find(tree: &Tree, ctx: &Context, spots: &[Spot]) -> Vec<Info> {
    let fold = ctx.os == Os::Windows;
    let root = components(ctx.os, tree.name(0));
    let mut out = Vec::new();
    for spot in spots {
        for mut comps in spot.at.bases(ctx.os, &ctx.known) {
            comps.extend_from_slice(spot.path);
            // The spot has to lie below the root.
            if comps.len() <= root.len() || !root.iter().zip(&comps).all(|(r, c)| fits(c, r, fold))
            {
                continue;
            }
            let mut level = vec![0u32];
            for mask in &comps[root.len()..] {
                level = level
                    .iter()
                    .flat_map(|&at| tree.children(at))
                    .filter(|&c| fits(mask, tree.name(c), fold))
                    .collect();
            }
            out.extend(
                level
                    .into_iter()
                    .filter(|&id| !busy(tree, id))
                    .map(|id| info(spot.kind, id)),
            );
        }
    }
    out
}

/// Its size is not final yet.
fn busy(tree: &Tree, mut id: u32) -> bool {
    while id != NO_PARENT {
        if tree.node(id).has(flags::PENDING | flags::SCANNING) {
            return true;
        }
        id = tree.node(id).parent;
    }
    false
}

fn info(kind: SpotKind, id: u32) -> Info {
    match kind {
        SpotKind::Pagefile => Info::Pagefile { id },
        SpotKind::Hiberfil => Info::Hiberfil { id },
        SpotKind::PreviousWindows => Info::PreviousWindows { id },
        SpotKind::WindowsUpdate => Info::WindowsUpdate { id },
        SpotKind::DeliveryOptimization => Info::DeliveryOptimization { id },
        SpotKind::ToolStore(command) => Info::ToolStore { id, command },
    }
}
