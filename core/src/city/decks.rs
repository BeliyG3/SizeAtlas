//! The decks of the bridges, run by run: a run several bridges share (a trunk) is one deck, and
//! runs of different bridges that cross or pass near each other stand on different levels.

use super::gates::segments_apart;
use super::trunk::{NEAR, one_run, touch};

/// For each of the bridges `lines`, the level of each of its runs. The distinct runs (one that
/// several bridges share counts once) take, in the order the bridges and their runs come, the
/// lowest level none of the earlier ones it [`conflicts`] with takes.
pub(crate) fn decks(lines: &[Vec<[f32; 2]>]) -> Vec<Vec<u8>> {
    // The distinct runs, each with the bridges that take it.
    let mut runs: Vec<([[f32; 2]; 2], Vec<usize>)> = Vec::new();
    let index: Vec<Vec<usize>> = (lines.iter().enumerate())
        .map(|(k, p)| {
            (p.windows(2))
                .map(|w| match runs.iter().position(|(r, _)| one_run(r, w)) {
                    Some(i) => {
                        runs[i].1.push(k);
                        i
                    }
                    None => {
                        runs.push(([w[0], w[1]], vec![k]));
                        runs.len() - 1
                    }
                })
                .collect()
        })
        .collect();
    let mut level = vec![0u8; runs.len()];
    for r in 0..runs.len() {
        let taken: Vec<u8> = (0..r)
            .filter(|&o| conflicts(&runs[r], &runs[o]))
            .map(|o| level[o])
            .collect();
        level[r] = (0..u8::MAX).find(|l| !taken.contains(l)).unwrap_or(u8::MAX);
    }
    (index.iter())
        .map(|runs| runs.iter().map(|&i| level[i]).collect())
        .collect()
}

/// Whether runs `s` and `t` (with the bridges that take them) cross or come within `NEAR`: not
/// where they meet end to end (a fork or a join), nor two runs of one bridge (it does not pass
/// over itself at its own turns).
fn conflicts(
    (s, of_s): &([[f32; 2]; 2], Vec<usize>),
    (t, of_t): &([[f32; 2]; 2], Vec<usize>),
) -> bool {
    !of_s.iter().any(|b| of_t.contains(b))
        && !touch(s, t)
        && segments_apart(s[0], s[1], t[0], t[1]) < NEAR as f32
}

#[cfg(test)]
#[path = "decks_tests.rs"]
mod tests;
