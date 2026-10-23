//! Search conditions written as words next to the name words: size (`>1GB`, `<=10MB`,
//! `100MB..1GB`), modified date (`older:1y`, `newer:30d`), type (`type:video`) and
//! `files` / `folders`. A word that does not parse as a condition is an ordinary name word.

use crate::categories::Category;
use crate::tree::Node;

const DAY_NS: i128 = 86_400_000_000_000;

/// Whether only files or only folders are wanted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Files,
    Folders,
}

/// The conditions of a query. Every one that is set has to hold; the bounds are resolved
/// byte limits, both inclusive (`>1GB` is `min_size` of 1 GiB + 1).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Filters {
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    /// Modified at least this many days before now.
    pub older_than_days: Option<u32>,
    /// Modified at most this many days before now.
    pub newer_than_days: Option<u32>,
    /// A file has to be of one of these; never a folder. Empty means any.
    pub types: Vec<Category>,
    pub kind: Option<Kind>,
}

/// One parsed condition.
enum Condition {
    Min(u64),
    Max(u64),
    Older(u32),
    Newer(u32),
    Type(Category),
    Kind(Kind),
}

impl Filters {
    /// Takes the word in if it is a condition (`lower` is lowercase) and says how many words
    /// that took: 0 for none, 2 when the word is a size without a unit and `next` is the
    /// unit (`>1 GB`).
    pub(super) fn take(&mut self, lower: &str, next: Option<&str>) -> usize {
        let spaced = next
            .filter(|n| UNITS.iter().any(|(u, _)| u == n))
            .and_then(|unit| parse_word(&format!("{lower}{unit}")));
        let (conditions, taken) = match spaced {
            Some(conditions) => (conditions, 2),
            None => match parse_word(lower) {
                Some(conditions) => (conditions, 1),
                None => return 0,
            },
        };
        for condition in conditions {
            self.add(condition);
        }
        taken
    }

    /// Repeated conditions of one kind tighten each other, types add up, the last of
    /// `files` and `folders` wins.
    fn add(&mut self, condition: Condition) {
        match condition {
            Condition::Min(v) => self.min_size = self.min_size.max(Some(v)),
            Condition::Max(v) => self.max_size = Some(self.max_size.map_or(v, |m| m.min(v))),
            Condition::Older(d) => self.older_than_days = self.older_than_days.max(Some(d)),
            Condition::Newer(d) => {
                self.newer_than_days = Some(self.newer_than_days.map_or(d, |m| m.min(d)));
            }
            Condition::Type(c) => {
                if !self.types.contains(&c) {
                    self.types.push(c);
                }
            }
            Condition::Kind(k) => self.kind = Some(k),
        }
    }

    /// Whether the node passes every condition, `now_ns` being the current time like
    /// `Node::mtime`. An unknown modified time (0) passes neither date condition.
    pub(super) fn accepts(&self, node: &Node, now_ns: i64) -> bool {
        let is_dir = node.is_dir();
        if self.min_size.is_some_and(|m| node.size < m)
            || self.max_size.is_some_and(|m| node.size > m)
            || self.kind == Some(if is_dir { Kind::Files } else { Kind::Folders })
        {
            return false;
        }
        if !self.types.is_empty()
            && (is_dir || !self.types.iter().any(|&c| c as u8 == node.category))
        {
            return false;
        }
        if self.older_than_days.is_none() && self.newer_than_days.is_none() {
            return true;
        }
        if node.mtime <= 0 {
            return false;
        }
        let age = i128::from(now_ns) - i128::from(node.mtime);
        self.older_than_days
            .is_none_or(|d| age >= i128::from(d) * DAY_NS)
            && self
                .newer_than_days
                .is_none_or(|d| age <= i128::from(d) * DAY_NS)
    }
}

/// A condition word gives one condition, or two for a range.
fn parse_word(word: &str) -> Option<Vec<Condition>> {
    if let Some(rest) = word.strip_prefix("older:") {
        return Some(vec![Condition::Older(days(rest)?)]);
    }
    if let Some(rest) = word.strip_prefix("newer:") {
        return Some(vec![Condition::Newer(days(rest)?)]);
    }
    if let Some(rest) = word.strip_prefix("type:") {
        return Some(vec![Condition::Type(category(rest)?)]);
    }
    match word {
        "files" => return Some(vec![Condition::Kind(Kind::Files)]),
        "folders" => return Some(vec![Condition::Kind(Kind::Folders)]),
        _ => {}
    }
    if let Some(rest) = word.strip_prefix(">=") {
        return Some(vec![Condition::Min(size(rest)?)]);
    }
    if let Some(rest) = word.strip_prefix("<=") {
        return Some(vec![Condition::Max(size(rest)?)]);
    }
    if let Some(rest) = word.strip_prefix('>') {
        return Some(vec![Condition::Min(size(rest)?.saturating_add(1))]);
    }
    if let Some(rest) = word.strip_prefix('<') {
        // Nothing is smaller than 0 bytes: a name word, not a condition that finds nothing.
        return Some(vec![Condition::Max(size(rest)?.checked_sub(1)?)]);
    }
    let (from, to) = word.split_once("..")?;
    let ((from, from_unit), (to, to_unit)) = (sized(from)?, sized(to)?);
    // Two bare numbers (`2019..2020`) are more likely a name than a range of bytes.
    (from <= to && (from_unit || to_unit)).then(|| vec![Condition::Min(from), Condition::Max(to)])
}

/// `30d`, `2w`, `6m` (30 days), `1y` (365 days) as days.
fn days(text: &str) -> Option<u32> {
    let unit = text.chars().last()?;
    let count = &text[..text.len() - unit.len_utf8()];
    // `parse` alone would take a leading `+`.
    if count.is_empty() || !count.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let count: u32 = count.parse().ok()?;
    let per = match unit {
        'd' => 1,
        'w' => 7,
        'm' => 30,
        'y' => 365,
        _ => return None,
    };
    count.checked_mul(per)
}

fn category(text: &str) -> Option<Category> {
    Some(match text {
        "video" | "videos" => Category::Video,
        "image" | "images" => Category::Images,
        "audio" => Category::Audio,
        "document" | "documents" => Category::Documents,
        "archive" | "archives" => Category::Archives,
        "code" => Category::Code,
        "program" | "programs" => Category::Executables,
        "other" => Category::Other,
        _ => return None,
    })
}

/// Unit words (lowercase) and what they are worth: base 1024, Latin or Russian.
const UNITS: [(&str, u128); 10] = [
    ("b", 1),
    ("б", 1),
    ("kb", 1 << 10),
    ("кб", 1 << 10),
    ("mb", 1 << 20),
    ("мб", 1 << 20),
    ("gb", 1 << 30),
    ("гб", 1 << 30),
    ("tb", 1 << 40),
    ("тб", 1 << 40),
];

fn size(text: &str) -> Option<u64> {
    sized(text).map(|(bytes, _)| bytes)
}

/// Bytes of `1`, `1.5GB`, `1,5гб`: a number with a `.` or `,` fraction and an optional unit,
/// and whether there was a unit. Rounded down, capped at `u64::MAX`; only a number of 39 or
/// so digits is no size at all.
fn sized(text: &str) -> Option<(u64, bool)> {
    let end = text
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == ','))
        .unwrap_or(text.len());
    let (number, unit) = text.split_at(end);
    let per = match UNITS.iter().find(|(u, _)| *u == unit) {
        Some(&(_, per)) => per,
        None if unit.is_empty() => 1,
        None => return None,
    };
    let (whole, fraction) = number.split_once(['.', ',']).unwrap_or((number, ""));
    let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    // A separator needs digits on both sides.
    if whole.is_empty()
        || !digits(whole)
        || !digits(fraction)
        || (number.len() > whole.len() && fraction.is_empty())
    {
        return None;
    }
    let mut bytes = whole.parse::<u128>().ok()?.saturating_mul(per);
    // 18 digits of the fraction are plenty for a size.
    let fraction = &fraction[..fraction.len().min(18)];
    if !fraction.is_empty() {
        let scale = 10u128.pow(fraction.len() as u32);
        bytes = bytes.saturating_add(fraction.parse::<u128>().ok()? * per / scale);
    }
    Some((u64::try_from(bytes).unwrap_or(u64::MAX), !unit.is_empty()))
}
