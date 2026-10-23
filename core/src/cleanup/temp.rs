//! Rules 1 and 1b: old items of `%TEMP%` and `%SystemRoot%\Temp`, and the names never touched
//! in either.

use super::paths::At;
use super::{Age, Mode, Place, Reason, Rule, Target};

/// The two Temp folders.
pub(crate) const PLACES: [(At, &[&str]); 2] = [(At::Temp, &[]), (At::SystemRoot, &["Temp"])];

/// Work of AI tools, low-integrity apps, archive extractions, this app and its WebView: never
/// listed, nothing inside them either.
///
/// ponytail: `Temp1_*` and `7z*` are spared at any age, not only below a day old as the spec
/// says: that test needs the creation time, which the tree lacks.
pub(crate) const EXCLUDED: &[&str] = &[
    "claude*",
    "codex*",
    "cursor*",
    "Low",
    "Temp1_*",
    "7z*",
    "*sizeatlas*",
    "EBWebView",
];

const OLD: Option<Age> = Some(Age {
    days: 7,
    young: None,
});

/// Old items only; work markers inside or a size above 1 GiB send them to Review, and a pending
/// restart hides those of `%SystemRoot%\Temp`.
pub(crate) const RULES: [Rule; 2] = [
    Rule {
        temp: true,
        age: OLD,
        ..Rule::new(
            Place::At(PLACES[0].0, PLACES[0].1),
            Target::Any("*"),
            Mode::Cleanup,
            Reason::TempOld,
        )
    },
    Rule {
        temp: true,
        age: OLD,
        reboot_blocks: true,
        ..Rule::new(
            Place::At(PLACES[1].0, PLACES[1].1),
            Target::Any("*"),
            Mode::Cleanup,
            Reason::TempOld,
        )
    },
];
