//! Component patterns from the file-system root, matched one name at a time as a walk goes down.

use super::Os;
use super::paths::{At, Known, fits};

/// A table entry: a known folder and the components below it.
pub(crate) type Entry = (At, &'static [&'static str]);

/// What a pattern means for the node it ends at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Hit {
    /// The node is a candidate of rule `n`.
    Rule(u32),
    /// The node and its subtree are never touched.
    Never,
    /// Cancels a `Never` ending at the same node (`%SystemRoot%\Temp`).
    Open,
    /// "Anywhere" rules skip the node and its subtree.
    Zone,
    /// Cancels a `Zone` ending at the same node (the user's own profile in `Users`).
    ZoneOpen,
}

/// A full component list from the file-system root.
pub(crate) struct Pattern<'a> {
    pub comps: Vec<&'a str>,
    pub hit: Hit,
    /// Compare ignoring case: rule places on Windows, never places and zones on Windows and macOS.
    fold: bool,
}

/// Adds one pattern per base of `at`: the base, then `path`, then `last` if any.
pub(crate) fn add<'a>(
    out: &mut Vec<Pattern<'a>>,
    (os, known): (Os, &'a Known),
    (at, path, last): (At, &'a [&'a str], Option<&'a str>),
    hit: Hit,
) {
    let fold = match hit {
        Hit::Rule(_) => os.folds(),
        _ => os != Os::Linux,
    };
    for mut comps in at.bases(os, known) {
        comps.extend_from_slice(path);
        comps.extend(last);
        out.push(Pattern { comps, hit, fold });
    }
}

/// Partial matches: (pattern, components matched so far).
pub(crate) type State = Vec<(u32, u8)>;

/// Every pattern, nothing matched yet.
pub(crate) fn start(patterns: &[Pattern]) -> State {
    (0..patterns.len() as u32).map(|p| (p, 0)).collect()
}

/// Feeds one name to every partial match; the result holds the ones that still fit, including
/// those that end at this name.
pub(crate) fn step(patterns: &[Pattern], state: &[(u32, u8)], name: &str) -> State {
    state
        .iter()
        .filter_map(|&(p, m)| {
            let pattern = &patterns[p as usize];
            let comp = pattern.comps.get(m as usize)?;
            fits(comp, name, pattern.fold).then_some((p, m + 1))
        })
        .collect()
}

/// The hits of the patterns that end at the node `state` was made for.
pub(crate) fn ended<'s>(
    patterns: &'s [Pattern],
    state: &'s [(u32, u8)],
) -> impl Iterator<Item = Hit> + 's {
    state
        .iter()
        .filter(|&&(p, m)| patterns[p as usize].comps.len() == m as usize)
        .map(|&(p, _)| patterns[p as usize].hit)
}

/// Whether the node `state` was made for is never touched (and not opened again).
pub(crate) fn is_never(patterns: &[Pattern], state: &[(u32, u8)]) -> bool {
    ended(patterns, state).any(|h| h == Hit::Never)
        && !ended(patterns, state).any(|h| h == Hit::Open)
}
