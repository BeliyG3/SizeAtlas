use super::*;
use crate::city::graph::Edge;
use crate::city::map::{Gate, Poly, PolyKind, Stats};
use crate::city::road::RoadClass;

fn poly(kind: PolyKind, id: u32, points: Vec<[f32; 2]>) -> Poly {
    Poly {
        kind,
        id,
        parent: 1,
        size: 1 << 40,
        points,
    }
}

fn edge(a: u32, b: u32, class: RoadClass, bridge: bool) -> Edge {
    Edge {
        a,
        b,
        class,
        bridge,
    }
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}

fn xy_at(b: &[u8], at: usize) -> (f32, f32) {
    let f = |at: usize| f32::from_le_bytes(b[at..at + 4].try_into().unwrap());
    (f(at), f(at + 4))
}

#[test]
fn offsets_follow_the_format() {
    let island = Island {
        width: 300.5,
        height: 200.25,
        polys: vec![
            poly(
                PolyKind::Island,
                1,
                vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]],
            ),
            poly(
                PolyKind::House,
                9,
                vec![[1.0, 1.0], [2.0, 1.0], [2.0, 2.0], [1.0, 2.5]],
            ),
        ],
        nodes: vec![[3.0, 4.0], [5.0, 6.0], [7.5, 8.5]],
        edges: vec![
            edge(0, 1, RoadClass::Highway, false),
            edge(1, 2, RoadClass::Lane, true),
        ],
        gates: vec![Gate {
            node: 2,
            dir: [0.0, -1.0],
            neighbours: vec![4, 6],
        }],
        stats: Stats {
            built: 1.0,
            inner_empty: 0.0,
            shore: 0.0,
            water: 0.0,
        },
    };
    let b = encode_city(7, 8, 9, true, &island);
    assert_eq!(b.len(), 56 + 24 * 2 + 8 * 7 + 8 * 3 + 12 * 2 + 16);
    // The shared header, then the city's.
    assert_eq!(u64::from_le_bytes(b[0..8].try_into().unwrap()), 7);
    assert_eq!(u64::from_le_bytes(b[8..16].try_into().unwrap()), 8);
    assert_eq!(u32_at(&b, 16), 2);
    assert_eq!(b[20..24], [1, 0, 0, 0]);
    assert_eq!(u32_at(&b, 24), CITY_FORMAT);
    assert_eq!(xy_at(&b, 28), (300.5, 200.25));
    let counts: Vec<u32> = (36..56).step_by(4).map(|at| u32_at(&b, at)).collect();
    assert_eq!(counts, [7, 3, 2, 1, 9]);
    // Polygons.
    let p = CITY_HEADER_LEN;
    assert_eq!(b[p..p + 4], [0, 0, 3, 0]);
    assert_eq!([4, 8, 12].map(|o| u32_at(&b, p + o)), [1, 1, 0]);
    assert_eq!(
        u64::from_le_bytes(b[p + 16..p + 24].try_into().unwrap()),
        1 << 40
    );
    let p = p + POLY_LEN;
    assert_eq!(b[p..p + 4], [4, 0, 4, 0]);
    assert_eq!(u32_at(&b, p + 4), 9);
    // All the points, then the nodes.
    let points = CITY_HEADER_LEN + 2 * POLY_LEN;
    assert_eq!(xy_at(&b, points), (0.0, 0.0));
    assert_eq!(xy_at(&b, points + 6 * POINT_LEN), (1.0, 2.5));
    let nodes = points + 7 * POINT_LEN;
    assert_eq!(xy_at(&b, nodes), (3.0, 4.0));
    assert_eq!(xy_at(&b, nodes + 2 * POINT_LEN), (7.5, 8.5));
    // Edges.
    let edges = nodes + 3 * POINT_LEN;
    assert_eq!((u32_at(&b, edges), u32_at(&b, edges + 4)), (0, 1));
    assert_eq!(b[edges + 8..edges + 12], [0, 0, 0, 0]);
    let last = edges + EDGE_LEN;
    assert_eq!((u32_at(&b, last), u32_at(&b, last + 4)), (1, 2));
    assert_eq!(b[last + 8..last + 12], [4, 1, 0, 0]);
    // The gate, with its first neighbour only.
    let gate = edges + 2 * EDGE_LEN;
    assert_eq!(u32_at(&b, gate), 2);
    assert_eq!(xy_at(&b, gate + 4), (0.0, -1.0));
    assert_eq!(u32_at(&b, gate + 12), 4);
    assert_eq!(gate + GATE_LEN, b.len());
}

/// The frontend's golden map: every polygon kind and road class, a size past 2^32, a bridge
/// and a gate with no neighbour.
fn golden() -> Island {
    let kinds = [
        PolyKind::Island,
        PolyKind::Water,
        PolyKind::Land,
        PolyKind::District,
        PolyKind::Block,
        PolyKind::House,
        PolyKind::Filler,
        PolyKind::Square,
        PolyKind::Plaza,
        PolyKind::Vacant,
    ];
    let polys = kinds
        .iter()
        .enumerate()
        .map(|(k, &kind)| {
            let (k32, o) = (k as u32, k as f32 * 10.0);
            let mut points = vec![[o, o], [o + 8.5, o], [o + 8.5, o + 6.25]];
            points.extend((k % 2 == 1).then_some([o, o + 6.25]));
            Poly {
                kind,
                id: 100 + k32,
                parent: 99 + k32,
                size: (5 << 32) + u64::from(k32),
                points,
            }
        })
        .collect();
    let classes = [
        RoadClass::Highway,
        RoadClass::Ring,
        RoadClass::Ramp,
        RoadClass::Street,
        RoadClass::Lane,
    ];
    let edges = classes
        .iter()
        .enumerate()
        .map(|(k, &class)| edge(k as u32, k as u32 + 1, class, class == RoadClass::Street))
        .collect();
    Island {
        width: 120.5,
        height: 96.75,
        polys,
        nodes: (0..6).map(|k| [k as f32 * 12.5, 40.0 + k as f32]).collect(),
        edges,
        gates: vec![
            Gate {
                node: 0,
                dir: [-1.0, 0.0],
                neighbours: vec![3, 5],
            },
            Gate {
                node: 5,
                dir: [0.6, -0.8],
                neighbours: Vec::new(),
            },
        ],
        stats: Stats {
            built: 1.0,
            inner_empty: 0.0,
            shore: 0.0,
            water: 0.0,
        },
    }
}

/// `src/features/city/world/__fixtures__/city.hex`, which `map.test.ts` parses: the encoder's
/// output for `golden()`, in hex, 32 bytes a line. `UPDATE_GOLDEN=1` writes it anew.
#[test]
fn the_frontend_fixture_is_what_the_encoder_writes() {
    let bytes = encode_city(42, 7, 0, true, &golden());
    let hex: String = bytes
        .chunks(32)
        .map(|line| line.iter().map(|b| format!("{b:02x}")).collect::<String>() + "\n")
        .collect();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/features/city/world/__fixtures__/city.hex");
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, &hex).unwrap();
    }
    let kept = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        kept.replace("\r\n", "\n") == hex,
        "{} is out of date: run this test with UPDATE_GOLDEN=1",
        path.display()
    );
}
