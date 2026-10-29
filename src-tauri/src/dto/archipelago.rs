//! The archipelago of the open drives: where each island lies and the bridges between them.

use serde::Serialize;
use sizeatlas_core::city::Bridge;

/// One island of the archipelago, moved by `(x, z)` metres.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchipelagoIslandDto {
    pub generation: u64,
    /// The `rev` of the tree this island was built from: the one in the header of the island's
    /// `get_city` bytes. Offsets and gate nodes fit those bytes only while the two are equal.
    pub rev: u64,
    pub root: String,
    pub x: f32,
    pub z: f32,
}

/// A bridge between two gates, each `[island, gate node]` (the island is an index of `islands`).
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchipelagoBridgeDto {
    pub a: [u32; 2],
    pub b: [u32; 2],
    pub points: Vec<[f32; 2]>,
    pub level: u8,
}

impl From<Bridge> for ArchipelagoBridgeDto {
    fn from(bridge: Bridge) -> Self {
        let end = |(island, node): (usize, u32)| [island as u32, node];
        Self {
            a: end(bridge.a),
            b: end(bridge.b),
            points: bridge.points,
            level: bridge.level,
        }
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchipelagoDto {
    pub islands: Vec<ArchipelagoIslandDto>,
    pub bridges: Vec<ArchipelagoBridgeDto>,
}
