//! Names that classify a matched item: signs of work in a Temp item, and lock files that make a
//! `node_modules` or a venv restorable.

use std::sync::LazyLock;

use super::Reason;
use super::names::Names;

/// Unsaved or ongoing work: a Temp item holding one of these goes to Review (`TempWork`).
const WORK: &[&str] = &[
    "*.blend",
    "*.blend1",
    "~$*",
    "UnsavedFiles",
    "*.psd",
    "*.kra",
    "*.xcf",
    ".git",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "*.sln",
];

const NODE_LOCKS: &[&str] = &[
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
];

const PYTHON_LOCKS: &[&str] = &[
    "requirements*.txt",
    "poetry.lock",
    "uv.lock",
    "Pipfile.lock",
];

/// Compared ignoring case on every OS.
pub(crate) static WORK_NAMES: LazyLock<Names> = LazyLock::new(|| Names::new(WORK, true));

/// The lock files that make an item of `reason` restorable; `None` for other reasons.
pub(crate) fn locks(reason: Reason) -> Option<&'static [&'static str]> {
    match reason {
        Reason::NodeModules => Some(NODE_LOCKS),
        Reason::PythonVenv => Some(PYTHON_LOCKS),
        _ => None,
    }
}
