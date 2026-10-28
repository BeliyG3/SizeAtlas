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
    let b = encode_city(7, 8, true, &island);
    assert_eq!(b.len(), 56 + 24 * 2 + 8 * 7 + 8 * 3 + 12 * 2 + 16);
    // The shared header, then the city's.
    assert_eq!(u64::from_le_bytes(b[0..8].try_into().unwrap()), 7);
    assert_eq!(u64::from_le_bytes(b[8..16].try_into().unwrap()), 8);
    assert_eq!(u32_at(&b, 16), 2);
    assert_eq!(b[20..24], [1, 0, 0, 0]);
    assert_eq!(u32_at(&b, 24), CITY_FORMAT);
    assert_eq!(xy_at(&b, 28), (300.5, 200.25));
    let counts: Vec<u32> = (36..56).step_by(4).map(|at| u32_at(&b, at)).collect();
    assert_eq!(counts, [7, 3, 2, 1, 0]);
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
