use super::*;
use crate::city::CELL;
use crate::city::lattice::Line;
use std::f32::consts::FRAC_PI_4;

fn dry() -> Grid<bool> {
    Grid::new(200, 200, false)
}

fn seg(a: [f32; 2], b: [f32; 2], class: RoadClass) -> ([f32; 2], [f32; 2], RoadClass) {
    (a, b, class)
}

fn degree(edges: &[Edge], n: usize) -> usize {
    edges
        .iter()
        .filter(|e| e.a as usize == n || e.b as usize == n)
        .count()
}

fn node(nodes: &[[f32; 2]], p: [f32; 2]) -> usize {
    nodes
        .iter()
        .position(|q| apart(*q, p) < 1e-4)
        .unwrap_or_else(|| panic!("no node at {p:?} in {nodes:?}"))
}

fn assert_octilinear(nodes: &[[f32; 2]], edges: &[Edge]) {
    for e in edges {
        let (a, b) = (nodes[e.a as usize], nodes[e.b as usize]);
        let k = (b[1] - a[1]).atan2(b[0] - a[0]) / FRAC_PI_4;
        assert!((k - k.round()).abs() * FRAC_PI_4 < 1e-3, "{a:?} {b:?}");
    }
}

#[test]
fn crossing_roads_meet_at_a_node() {
    let (nodes, edges) = build(
        vec![
            seg([0.0, 50.0], [100.0, 50.0], RoadClass::Street),
            seg([50.0, 0.0], [50.0, 100.0], RoadClass::Street),
            seg([10.0, 90.0], [90.0, 10.0], RoadClass::Lane),
        ],
        &dry(),
        &[],
    );
    assert_eq!(degree(&edges, node(&nodes, [50.0, 50.0])), 6);
    assert_eq!(edges.len(), 6);
    assert_octilinear(&nodes, &edges);
}

#[test]
fn a_road_ending_on_another_splits_it() {
    let (nodes, edges) = build(
        vec![
            seg([0.0, 0.0], [100.0, 0.0], RoadClass::Street),
            seg([40.0, 0.0], [40.0, 60.0], RoadClass::Street),
        ],
        &dry(),
        &[],
    );
    assert_eq!(edges.len(), 3);
    assert_eq!(degree(&edges, node(&nodes, [40.0, 0.0])), 3);
}

#[test]
fn a_loose_lane_end_reaches_the_street() {
    let (nodes, edges) = build(
        vec![
            seg([0.0, 0.0], [100.0, 0.0], RoadClass::Street),
            seg([50.0, 4.5], [50.0, 40.0], RoadClass::Lane),
            // Too far from the street to be carried on to it.
            seg([80.0, 7.0], [80.0, 40.0], RoadClass::Lane),
        ],
        &dry(),
        &[],
    );
    let at = node(&nodes, [50.0, 0.0]);
    assert_eq!(degree(&edges, at), 3);
    assert!(nodes.iter().all(|p| apart(*p, [80.0, 0.0]) > 1.0));
}

#[test]
fn roads_side_by_side_become_one() {
    let (nodes, edges) = build(
        vec![
            seg([0.0, 0.0], [100.0, 0.0], RoadClass::Highway),
            // A street 3 m off the highway, running on past both of its ends.
            seg([-50.0, 3.0], [150.0, 3.0], RoadClass::Street),
            // A near duplicate of the highway.
            seg([0.0, -2.5], [60.0, -2.5], RoadClass::Highway),
        ],
        &dry(),
        &[],
    );
    let on = |e: &Edge, y: f32| nodes[e.a as usize][1] == y && nodes[e.b as usize][1] == y;
    let len = |y: f32| -> f32 {
        let along = edges.iter().filter(|e| on(e, y));
        along.map(|e| length(&nodes, e)).sum()
    };
    assert_eq!(len(0.0), 100.0);
    assert_eq!(len(3.0), 100.0);
    assert_eq!(len(-2.5), 0.0);
    // The street joins the highway at both of its ends.
    for x in [0.0, 100.0] {
        assert_eq!(degree(&edges, node(&nodes, [x, 0.0])), 2);
        assert_eq!(degree(&edges, node(&nodes, [x, 3.0])), 2);
    }
    let (kept, ..) = keep_connected(nodes.clone(), edges.clone(), [50.0, 0.0]);
    assert_eq!(kept.len(), nodes.len());
}

#[test]
fn a_crossing_over_water_is_a_bridge_and_a_road_along_it_ends_at_the_bank() {
    // Water from y = 60 to y = 87 m (18 cells) across the whole grid.
    let mut water = dry();
    for y in 40..58 {
        for x in 0..200 {
            water.set(x, y, true);
        }
    }
    let (nodes, edges) = build(
        vec![
            seg([100.0, 0.0], [100.0, 150.0], RoadClass::Street),
            seg([0.0, 75.0], [200.0, 75.0], RoadClass::Street),
            seg([20.0, 40.0], [20.0, 70.0], RoadClass::Lane),
            // Across at 45°: 38 m over water.
            seg([140.0, 50.0], [180.0, 90.0], RoadClass::Street),
        ],
        &water,
        &[[0.0, 73.5], [300.0, 73.5]],
    );
    let bridges: Vec<&Edge> = edges.iter().filter(|e| e.bridge).collect();
    let x = |e: &Edge| (nodes[e.a as usize][0], nodes[e.b as usize][0]);
    let (straight, diagonal): (Vec<&Edge>, Vec<&Edge>) =
        bridges.iter().partition(|e| x(e) == (100.0, 100.0));
    let span = |b: &[&Edge]| -> f32 { b.iter().map(|e| length(&nodes, e)).sum() };
    assert_eq!(span(&straight), 18.0 * CELL);
    assert!(
        (span(&diagonal) - 27.0 * std::f32::consts::SQRT_2).abs() < 1.0,
        "{diagonal:?}"
    );
    // Nothing runs along the water, and the lane stops at the bank.
    let y = |e: &Edge| (nodes[e.a as usize][1], nodes[e.b as usize][1]);
    assert!(!edges.iter().any(|e| y(e) == (75.0, 75.0)));
    let wet = |p: [f32; 2]| p[1] > 60.5 && p[1] < 86.5;
    for e in edges.iter().filter(|e| !e.bridge) {
        let (a, b) = (nodes[e.a as usize], nodes[e.b as usize]);
        assert!(
            !wet([(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]),
            "{a:?} {b:?}"
        );
    }
}

#[test]
fn short_loose_pieces_are_dropped() {
    let (nodes, edges) = build(
        vec![
            seg([0.0, 0.0], [100.0, 0.0], RoadClass::Street),
            // Runs 0.75 m past the street.
            seg([30.0, -0.75], [30.0, 40.0], RoadClass::Lane),
        ],
        &dry(),
        &[],
    );
    assert_eq!(edges.len(), 3);
    assert!(nodes.iter().all(|p| p[1] >= 0.0));
}

#[test]
fn snapping_keeps_shared_stretches_and_directions() {
    let shared = [[10.3, 7.1], [40.3, 7.1], [60.3, 27.1]];
    let line = |from: [f32; 2], to: [f32; 2]| -> Vec<[f32; 2]> {
        [from].into_iter().chain(shared).chain([to]).collect()
    };
    let sa = snap_line(&line([0.1, 17.1], [60.3, 90.0]));
    let sb = snap_line(&line([10.3, -20.0], [100.0, 27.1]));
    // The bend inside the shared stretch is the same point in both.
    assert_eq!(sa[2], sb[2]);
    assert_eq!(sa.len(), 5);
    for line in [&sa, &sb] {
        for w in line.windows(2) {
            assert!(crate::city::lattice::dir(w[0], w[1]).is_some(), "{w:?}");
        }
    }
    // Two lines at 45° and 135° cross on the lattice.
    let p = Line { f: 1, c: 16 }.cross(Line { f: 3, c: 48 });
    assert_eq!(p, Some([32, 16]));
}
