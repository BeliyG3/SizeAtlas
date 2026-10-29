use super::*;
use crate::city::path::apart;

fn edge(a: u32, b: u32, class: RoadClass) -> Edge {
    Edge {
        a,
        b,
        class,
        bridge: false,
    }
}

/// Every overpass edge at a node with another overpass edge goes on by 45° at most.
fn assert_smooth(nodes: &[[f32; 2]], edges: &[Edge]) {
    for (n, &p) in nodes.iter().enumerate() {
        let out: Vec<[f32; 2]> = edges
            .iter()
            .filter(|e| e.class.overpass() && (e.a as usize == n || e.b as usize == n))
            .map(|e| {
                let q = nodes[if e.a as usize == n { e.b } else { e.a } as usize];
                let d = apart(p, q);
                [(q[0] - p[0]) / d, (q[1] - p[1]) / d]
            })
            .collect();
        for (i, u) in out.iter().enumerate() {
            let on = (out.iter().enumerate())
                .any(|(j, v)| i != j && u[0] * v[0] + u[1] * v[1] <= -0.707);
            assert!(out.len() < 2 || on, "{p:?}: {out:?} in {edges:?} {nodes:?}");
        }
    }
}

#[test]
fn a_right_angle_is_cut() {
    let nodes = vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0]];
    let edges = vec![
        edge(0, 1, RoadClass::Highway),
        edge(1, 2, RoadClass::Highway),
    ];
    let (nodes, edges) = smooth(nodes, edges, &[]);
    assert_smooth(&nodes, &edges);
    // The corner is off the overpasses.
    let corner = nodes.iter().position(|&p| p == [100.0, 0.0]);
    assert!(corner.is_none_or(|c| edges.iter().all(|e| e.a as usize != c && e.b as usize != c)));
}

#[test]
fn a_ramp_meeting_a_highway_square_on_bends_into_it() {
    // A highway along y = 0 and a ramp from below ending on it at 90° (a T).
    let nodes = vec![[0.0, 0.0], [50.0, 0.0], [100.0, 0.0], [50.0, 80.0]];
    let edges = vec![
        edge(0, 1, RoadClass::Highway),
        edge(1, 2, RoadClass::Highway),
        edge(3, 1, RoadClass::Ramp),
    ];
    let (nodes, edges) = smooth(nodes, edges, &[]);
    assert_smooth(&nodes, &edges);
    // The highway still runs through from end to end.
    let on_highway: f32 = (edges.iter())
        .filter(|e| e.class == RoadClass::Highway)
        .map(|e| apart(nodes[e.a as usize], nodes[e.b as usize]))
        .sum();
    assert_eq!(on_highway, 100.0);
    assert_eq!(edges.len(), 5, "{edges:?}");
}

#[test]
fn a_street_at_the_corner_keeps_its_way_on() {
    let nodes = vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [150.0, 0.0]];
    let edges = vec![
        edge(0, 1, RoadClass::Highway),
        edge(1, 2, RoadClass::Highway),
        edge(1, 3, RoadClass::Street),
    ];
    let (nodes, edges) = smooth(nodes, edges, &[]);
    assert_smooth(&nodes, &edges);
    let corner = nodes.iter().position(|&p| p == [100.0, 0.0]).unwrap() as u32;
    let overpass = |e: &&Edge| e.class.overpass() && (e.a == corner || e.b == corner);
    assert_eq!(edges.iter().filter(overpass).count(), 1);
}

#[test]
fn a_hairpin_is_cut_in_turns_of_45() {
    let nodes = vec![[0.0, 0.0], [100.0, 0.0], [0.0, 100.0]];
    let edges = vec![edge(0, 1, RoadClass::Ramp), edge(1, 2, RoadClass::Ramp)];
    let (nodes, edges) = smooth(nodes, edges, &[]);
    assert_smooth(&nodes, &edges);
}

#[test]
fn a_crossing_and_gentle_roads_stay() {
    let nodes = vec![
        [0.0, 50.0],
        [50.0, 50.0],
        [100.0, 50.0],
        [50.0, 0.0],
        [50.0, 100.0],
    ];
    let edges = vec![
        edge(0, 1, RoadClass::Highway),
        edge(1, 2, RoadClass::Highway),
        edge(3, 1, RoadClass::Ring),
        edge(1, 4, RoadClass::Ring),
    ];
    assert_eq!(smooth(nodes.clone(), edges.clone(), &[]), (nodes, edges));
}

#[test]
fn streets_may_turn_square() {
    let nodes = vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0]];
    let edges = vec![edge(0, 1, RoadClass::Street), edge(1, 2, RoadClass::Street)];
    assert_eq!(smooth(nodes.clone(), edges.clone(), &[]), (nodes, edges));
}

#[test]
fn a_cut_keeps_off_the_bridges() {
    // A 1 m jog joins (50, 0) and (51, 0); both send a ramp along +y (parallel, no cut joins
    // them), and the only other way is a bridge to the west.
    let nodes = vec![
        [0.0, 0.0],
        [50.0, 0.0],
        [51.0, 0.0],
        [50.0, 80.0],
        [51.0, 80.0],
    ];
    let mut west = edge(0, 1, RoadClass::Highway);
    west.bridge = true;
    let edges = vec![
        west,
        edge(1, 2, RoadClass::Highway),
        edge(1, 3, RoadClass::Ramp),
        edge(2, 4, RoadClass::Ramp),
    ];
    let (nodes, edges) = smooth(nodes, edges, &[]);
    let bridges: Vec<_> = (edges.iter().filter(|e| e.bridge))
        .map(|e| (nodes[e.a as usize], nodes[e.b as usize]))
        .collect();
    assert_eq!(bridges, vec![([0.0, 0.0], [50.0, 0.0])]);
}

#[test]
fn a_short_overpass_under_another_deck_goes_when_nothing_needs_it() {
    // A highway turning 45° at (0, 2); a ring jogs beside it and ends with 4 m along +x on the
    // highway's diagonal, too short to bend into the highway (a loop under its deck).
    let nodes = vec![
        [0.0, -60.0],
        [0.0, 0.0],
        [0.0, 2.0],
        [4.0, 6.0],
        [40.0, 42.0],
        [-2.0, 2.0],
        [-2.0, 4.0],
        [0.0, 6.0],
    ];
    let edges = vec![
        edge(0, 1, RoadClass::Highway),
        edge(1, 2, RoadClass::Highway),
        edge(2, 3, RoadClass::Highway),
        edge(3, 4, RoadClass::Highway),
        edge(1, 5, RoadClass::Ring),
        edge(5, 6, RoadClass::Ring),
        edge(6, 7, RoadClass::Ring),
        edge(7, 3, RoadClass::Ring),
    ];
    let (nodes, edges) = smooth(nodes, edges, &[]);
    assert!(edges.iter().all(|e| {
        let (a, b) = (nodes[e.a as usize], nodes[e.b as usize]);
        !(a[1] == 6.0 && b[1] == 6.0)
    }));
    assert_eq!(
        edges
            .iter()
            .filter(|e| e.class == RoadClass::Highway)
            .count(),
        4
    );
}

#[test]
fn a_gate_keeps_its_straight() {
    // A gate's straight from the shore at (0, 0) east, and a ramp meeting the shore end square
    // on from the south.
    let nodes = vec![[0.0, 0.0], [90.0, 0.0], [0.0, 50.0]];
    let edges = vec![edge(0, 1, RoadClass::Highway), edge(2, 0, RoadClass::Ramp)];
    let (out_nodes, out_edges) = smooth(nodes.clone(), edges.clone(), &[([0.0, 0.0], 4)]);
    let straight = (out_edges.iter())
        .filter(|e| e.class == RoadClass::Highway)
        .map(|e| apart(out_nodes[e.a as usize], out_nodes[e.b as usize]))
        .sum::<f32>();
    assert_eq!(straight, 90.0);
    assert!(out_nodes.contains(&[0.0, 0.0]));
    assert_smooth(&out_nodes, &out_edges);
}
