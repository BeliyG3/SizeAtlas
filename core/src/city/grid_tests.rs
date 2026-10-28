use super::*;

fn mask_from(rows: &[&str]) -> Grid<bool> {
    let mut g = Grid::new(rows[0].len(), rows.len(), false);
    for (y, row) in rows.iter().enumerate() {
        for (x, c) in row.bytes().enumerate() {
            g.set(x, y, c == b'#');
        }
    }
    g
}

#[test]
fn distance_is_exact_on_small_cases() {
    let mut m = Grid::new(9, 9, false);
    m.set(4, 4, true);
    let (d, near) = distance(&m);
    assert_eq!(d.get(4, 4), 0.0);
    assert_eq!(near.get(4, 4), m.idx(4, 4) as u32);
    assert!((d.get(0, 0) - 32f32.sqrt()).abs() < 1e-5);
    assert!((d.get(8, 4) - 4.0).abs() < 1e-5);
    assert_eq!(near.get(0, 0), m.idx(4, 4) as u32);
}

#[test]
fn distance_matches_brute_force_on_noise() {
    let (w, h) = (23, 17);
    let mut seed = 12345u32;
    let mut m = Grid::new(w, h, false);
    for b in m.data.iter_mut() {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        *b = (seed >> 24).is_multiple_of(23);
    }
    let (d, near) = distance(&m);
    for y in 0..h {
        for x in 0..w {
            let mut best = f32::INFINITY;
            for sy in 0..h {
                for sx in 0..w {
                    if m.get(sx, sy) {
                        let (dx, dy) = (x as f32 - sx as f32, y as f32 - sy as f32);
                        best = best.min((dx * dx + dy * dy).sqrt());
                    }
                }
            }
            assert!((d.get(x, y) - best).abs() < 1e-4, "({x},{y})");
            let n = near.get(x, y) as usize;
            assert!(m.data[n], "nearest index must be a source cell");
            let (nx, ny) = (n % w, n / w);
            let (dx, dy) = (x as f32 - nx as f32, y as f32 - ny as f32);
            assert!(((dx * dx + dy * dy).sqrt() - best).abs() < 1e-4);
        }
    }
}

#[test]
fn distance_without_sources_is_infinite() {
    let (d, near) = distance(&Grid::new(4, 3, false));
    assert!(d.data.iter().all(|v| v.is_infinite()));
    assert!(near.data.iter().all(|&i| i == u32::MAX));
}

#[test]
fn close_fills_a_gap_and_open_removes_a_speck() {
    // Two bars with a one-cell gap, plus an isolated speck far away.
    let mut m = Grid::new(30, 12, false);
    for y in 3..9 {
        for x in 5..15 {
            m.set(x, y, true);
        }
        for x in 16..26 {
            m.set(x, y, true);
        }
    }
    m.set(2, 1, true);
    let closed = close(&m, 2.0);
    assert!(closed.get(15, 5), "the gap is filled");
    let opened = open(&m, 1.5);
    assert!(!opened.get(2, 1), "the speck is gone");
    assert!(opened.get(10, 5) && opened.get(20, 5), "the bars stay");
    assert!(!opened.get(15, 5), "open does not fill the gap");
}

#[test]
fn erode_keeps_cells_a_full_disk_away_from_false() {
    let mut m = Grid::new(11, 11, false);
    for y in 2..9 {
        for x in 2..9 {
            m.set(x, y, true);
        }
    }
    let e = erode(&m, 2.0);
    let kept = e.data.iter().filter(|&&b| b).count();
    assert_eq!(kept, 9); // 3x3 core: 2 cells from every edge cell of the 7x7 block
    assert!(e.get(5, 5) && !e.get(3, 5));
}

#[test]
fn fill_holes_closes_a_ring() {
    let ring = mask_from(&[
        "........", //
        ".######.", ".#....#.", ".#....#.", ".######.", "........",
    ]);
    let f = fill_holes(&ring);
    assert!(f.get(3, 2) && f.get(4, 3), "the inside is filled");
    assert!(!f.get(0, 0) && !f.get(7, 5), "the outside is not");
    // A ring open on one side is not a ring.
    let mut c = ring.clone();
    c.set(1, 2, false);
    c.set(0, 2, false);
    assert!(!fill_holes(&c).get(3, 2));
}

#[test]
fn label_counts_components() {
    let m = mask_from(&[
        "##....", //
        "##..##", "....##",
    ]);
    let (l, n) = label(&m);
    assert_eq!(n, 2);
    assert_eq!(l.get(0, 0), 0);
    assert_eq!(l.get(5, 2), 1);
    assert_eq!(l.get(3, 0), -1);
    // Diagonal neighbours are not connected.
    let (_, n) = label(&mask_from(&["#.", ".#"]));
    assert_eq!(n, 2);
}

#[test]
fn borders_mark_cells_before_a_label_change() {
    let m = mask_from(&["##..", "##.."]);
    let (l, _) = label(&m);
    let b = borders(&l);
    assert!(b.get(1, 0) && b.get(1, 1), "right of the block");
    assert!(!b.get(0, 0) && !b.get(3, 0));
    let (l, _) = label(&mask_from(&["#", "."]));
    assert!(borders(&l).get(0, 0), "cell above a different label");
}

#[test]
fn open_steps_matches_open_up_to_two() {
    let (w, h) = (31, 23);
    let mut seed = 777u32;
    let mut m = Grid::new(w, h, false);
    for b in m.data.iter_mut() {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        *b = !(seed >> 24).is_multiple_of(5);
    }
    for steps in [1, 2] {
        assert_eq!(open_steps(&m, steps), open(&m, steps as f32), "{steps}");
    }
}
