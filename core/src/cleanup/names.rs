//! Sets of name masks checked against every node, compiled once. Case is folded for ASCII
//! letters only (as NTFS does for these names); the name is folded once per node.

use super::paths::fits;

/// Masks split by shape: whole names, `*suffix`, `prefix*` and the rest.
pub(crate) struct Names {
    exact: Vec<String>,
    suffix: Vec<String>,
    prefix: Vec<String>,
    other: Vec<String>,
}

impl Names {
    /// With `fold`, masks are lower-cased and [`Names::has`] expects a name made by [`lower`].
    pub(crate) fn new(masks: &[&str], fold: bool) -> Names {
        let mut names = Names {
            exact: Vec::new(),
            suffix: Vec::new(),
            prefix: Vec::new(),
            other: Vec::new(),
        };
        for &mask in masks {
            let mask = if fold {
                mask.to_ascii_lowercase()
            } else {
                mask.to_owned()
            };
            let wild = |s: &str| s.contains(['*', '?']);
            if !wild(&mask) {
                names.exact.push(mask);
            } else if let Some(rest) = mask.strip_prefix('*').filter(|r| !wild(r)) {
                names.suffix.push(rest.to_owned());
            } else if let Some(rest) = mask.strip_suffix('*').filter(|r| !wild(r)) {
                names.prefix.push(rest.to_owned());
            } else {
                names.other.push(mask);
            }
        }
        names
    }

    pub(crate) fn has(&self, name: &str) -> bool {
        self.exact.iter().any(|n| n == name)
            || self.suffix.iter().any(|s| name.ends_with(s.as_str()))
            || self.prefix.iter().any(|s| name.starts_with(s.as_str()))
            || self.other.iter().any(|m| fits(m, name, false))
    }
}

/// `name` with ASCII letters lower-cased, into `buf`, which is reused from node to node.
pub(crate) fn lower<'b>(name: &str, buf: &'b mut String) -> &'b str {
    buf.clear();
    buf.push_str(name);
    buf.make_ascii_lowercase();
    buf
}
