//! Search of a subtree by name (substrings, masks `*`, `?` and extensions, case-insensitive)
//! and by conditions on size, modified date, type and files/folders (see `filters`).

use super::Tree;
use super::lists::TopN;

mod filters;
pub use filters::{Filters, Kind};

/// A parsed search text. Words are split on whitespace: `.ext` (no wildcard) is an extension,
/// a word with `*` or `?` is a mask over the whole name, any other word is a substring.
/// A name has to contain every substring and, if there are extensions or masks, match one;
/// condition words (`>1GB`, `older:1y`, `type:video`, `folders`) have to hold too, and a text
/// of conditions only is a query.
#[derive(Clone, Debug)]
pub struct Query {
    /// Lowercase substrings.
    words: Vec<String>,
    /// Extensions and masks, any of which is enough.
    alternatives: Vec<Alternative>,
    filters: Filters,
}

#[derive(Clone, Debug)]
enum Alternative {
    /// Lowercase, with the dot. Files only.
    Extension(String),
    Mask(Mask),
}

/// A lowercase mask, kept as bytes too when it is ASCII, for names that are ASCII.
#[derive(Clone, Debug)]
struct Mask {
    chars: Vec<char>,
    ascii: Option<Vec<u8>>,
}

/// The matches of a search below a folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    /// The largest matches (on disk), at most the limit, by size and then id.
    pub items: Vec<u32>,
    /// More items matched than the limit allowed.
    pub truncated: bool,
    /// All matches.
    pub count: u64,
    /// Size of all matches that have no matching folder above them (below the searched one).
    pub size: u64,
}

impl Query {
    /// `None` for an empty text or one of whitespace only.
    pub fn parse(text: &str) -> Option<Query> {
        let mut words = Vec::new();
        let mut alternatives = Vec::new();
        let mut filters = Filters::default();
        let lowered: Vec<String> = text.split_whitespace().map(str::to_lowercase).collect();
        let mut at = 0;
        while at < lowered.len() {
            let lower = lowered[at].clone();
            let taken = filters.take(&lower, lowered.get(at + 1).map(String::as_str));
            if taken > 0 {
                at += taken;
                continue;
            }
            at += 1;
            if lower.contains(['*', '?']) {
                alternatives.push(Alternative::Mask(Mask {
                    ascii: lower.is_ascii().then(|| lower.as_bytes().to_vec()),
                    chars: lower.chars().collect(),
                }));
            } else if lower.starts_with('.') {
                alternatives.push(Alternative::Extension(lower));
            } else {
                words.push(lower);
            }
        }
        (!words.is_empty() || !alternatives.is_empty() || filters != Filters::default()).then_some(
            Query {
                words,
                alternatives,
                filters,
            },
        )
    }

    pub fn filters(&self) -> &Filters {
        &self.filters
    }

    /// Whether the name fits the name words, masks and extensions (not the conditions).
    pub fn matches(&self, name: &str, is_dir: bool) -> bool {
        if name.is_ascii() {
            self.matches_in(&Name::Ascii(name), is_dir)
        } else {
            self.matches_in(&Name::Lower(name.to_lowercase()), is_dir)
        }
    }

    fn matches_in(&self, name: &Name, is_dir: bool) -> bool {
        self.words.iter().all(|w| name.contains(w))
            && (self.alternatives.is_empty()
                || self.alternatives.iter().any(|alt| match alt {
                    Alternative::Extension(ext) => !is_dir && name.ends_with(ext),
                    Alternative::Mask(mask) => name.fits(mask),
                }))
    }
}

/// A name to test: an ASCII one as it is (compared ignoring case, no allocation), any other
/// lowercased once.
enum Name<'a> {
    Ascii(&'a str),
    Lower(String),
}

impl Name<'_> {
    fn contains(&self, word: &str) -> bool {
        match self {
            Name::Ascii(s) => {
                word.is_ascii()
                    && s.as_bytes()
                        .windows(word.len())
                        .any(|w| w.eq_ignore_ascii_case(word.as_bytes()))
            }
            Name::Lower(s) => s.contains(word),
        }
    }

    fn ends_with(&self, ext: &str) -> bool {
        match self {
            Name::Ascii(s) => {
                let (s, ext) = (s.as_bytes(), ext.as_bytes());
                ext.is_ascii()
                    && s.len() >= ext.len()
                    && s[s.len() - ext.len()..].eq_ignore_ascii_case(ext)
            }
            Name::Lower(s) => s.ends_with(ext),
        }
    }

    fn fits(&self, mask: &Mask) -> bool {
        match self {
            // A mask with a non-ASCII character cannot match an ASCII name.
            Name::Ascii(s) => mask
                .ascii
                .as_deref()
                .is_some_and(|m| glob(m, s.as_bytes(), (b'*', b'?'), u8::eq_ignore_ascii_case)),
            Name::Lower(s) => {
                let text: Vec<char> = s.chars().collect();
                glob(&mask.chars, &text, ('*', '?'), |a, b| a == b)
            }
        }
    }
}

/// Whether `text` fits the whole of `mask`: `star` is any run, `any` one element. Walks both
/// once, going back to the last `star` on a mismatch, so it needs no recursion.
pub(crate) fn glob<T: Copy + PartialEq>(
    mask: &[T],
    text: &[T],
    (star, any): (T, T),
    same: impl Fn(&T, &T) -> bool,
) -> bool {
    let (mut m, mut t) = (0, 0);
    // Where to go on a mismatch: after the last star, one element further into the text.
    let mut back: Option<(usize, usize)> = None;
    while t < text.len() {
        if m < mask.len() && mask[m] == star {
            m += 1;
            back = Some((m, t));
        } else if m < mask.len() && (mask[m] == any || same(&mask[m], &text[t])) {
            m += 1;
            t += 1;
        } else if let Some((bm, bt)) = back {
            m = bm;
            t = bt + 1;
            back = Some((bm, t));
        } else {
            return false;
        }
    }
    mask[m..].iter().all(|&c| c == star)
}

impl Tree {
    /// The live nodes below `id` (not `id` itself) that fit `query`: the `limit` largest on
    /// disk, by size and then id, with the number and the size of all matches. A match inside
    /// a matching folder is counted but adds nothing to the size. `now_ns` (ns since the
    /// epoch, like `Node::mtime`) is what `older:` and `newer:` count back from.
    pub fn search(&self, id: u32, query: &Query, limit: usize, now_ns: i64) -> Found {
        let mut top = TopN::new(limit, self.len());
        let (mut count, mut size) = (0u64, 0u64);
        // Each node with whether a folder above it (below `id`) matched.
        let mut stack = vec![(id, false)];
        while let Some((at, mut covered)) = stack.pop() {
            let node = &self.nodes[at as usize];
            if at != id
                && query.filters.accepts(node, now_ns)
                && query.matches(&node.name, node.is_dir())
            {
                count += 1;
                if !covered {
                    size = size.saturating_add(node.size);
                }
                top.push(i128::from(node.size), at);
                covered = true;
            }
            if node.is_dir() {
                for child in node.first_child..node.first_child + node.child_count {
                    if self.nodes[child as usize].is_alive() {
                        stack.push((child, covered));
                    }
                }
            }
        }
        let list = top.finish();
        Found {
            items: list.items,
            truncated: list.truncated,
            count,
            size,
        }
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_filters;
#[cfg(test)]
mod tests_matching;
