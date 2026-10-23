//! Condition words: how they parse and how they filter a built tree.

use super::*;
use crate::categories::Category;
const KB: u64 = 1 << 10;
const MB: u64 = 1 << 20;
const GB: u64 = 1 << 30;

fn q(text: &str) -> Query {
    Query::parse(text).unwrap()
}

fn filters(text: &str) -> Filters {
    Query::parse(text).unwrap().filters().clone()
}

/// Words that are not conditions leave the filters empty and stay name words.
fn is_name_word(text: &str) {
    assert_eq!(filters(text), Filters::default(), "{text}");
}

#[test]
fn size_bounds_are_resolved_to_inclusive_byte_limits() {
    let f = filters(">1GB");
    assert_eq!((f.min_size, f.max_size), (Some(GB + 1), None));
    let f = filters(">=1GB");
    assert_eq!(f.min_size, Some(GB));
    let f = filters("<10MB");
    assert_eq!((f.min_size, f.max_size), (None, Some(10 * MB - 1)));
    let f = filters("<=10MB");
    assert_eq!(f.max_size, Some(10 * MB));
    let f = filters("100MB..1GB");
    assert_eq!((f.min_size, f.max_size), (Some(100 * MB), Some(GB)));
    // No unit is bytes.
    assert_eq!(filters(">500").min_size, Some(501));
    assert_eq!(filters(">=500b").min_size, Some(500));
}

#[test]
fn units_are_base_1024_in_any_case_and_language() {
    for (text, bytes) in [
        (">=1KB", KB),
        (">=1kb", KB),
        (">=1Kb", KB),
        (">=1КБ", KB),
        (">=2mb", 2 * MB),
        (">=2МБ", 2 * MB),
        (">=1GB", GB),
        (">=1гб", GB),
        (">=1ГБ", GB),
        (">=1TB", GB << 10),
        (">=1Тб", GB << 10),
        (">=7Б", 7),
    ] {
        assert_eq!(filters(text).min_size, Some(bytes), "{text}");
    }
}

#[test]
fn a_fraction_has_a_dot_or_a_comma() {
    assert_eq!(filters(">=1.5GB").min_size, Some(GB + GB / 2));
    assert_eq!(filters(">=1,5GB").min_size, Some(GB + GB / 2));
    assert_eq!(filters(">=1,5ГБ").min_size, Some(GB + GB / 2));
    assert_eq!(filters(">=0.5KB").min_size, Some(512));
    // Rounded down.
    assert_eq!(filters(">=1.0009765625KB").min_size, Some(KB + 1));
    assert_eq!(filters(">=0.0001KB").min_size, Some(0));
    assert_eq!(filters("0,5GB..1.5GB").max_size, Some(GB + GB / 2));
}

#[test]
fn a_huge_size_is_capped_not_wrapped() {
    assert_eq!(filters(">=1000000TB").min_size, Some(1_000_000 << 40));
    assert_eq!(filters(">=99999999999999TB").min_size, Some(u64::MAX));
    assert_eq!(filters("<=18446744073709551616").max_size, Some(u64::MAX));
    assert_eq!(filters(">18446744073709551615").min_size, Some(u64::MAX));
    // Too many digits even for the arithmetic: a name word.
    is_name_word(&format!(">{}", "9".repeat(50)));
}

#[test]
fn dates_count_days_weeks_months_and_years() {
    for (text, days) in [
        ("older:30d", 30),
        ("older:2w", 14),
        ("older:6m", 180),
        ("older:1y", 365),
        ("OLDER:1Y", 365),
        ("older:0d", 0),
    ] {
        assert_eq!(filters(text).older_than_days, Some(days), "{text}");
    }
    assert_eq!(filters("newer:30d").newer_than_days, Some(30));
    assert_eq!(filters("newer:2y").newer_than_days, Some(730));
}

#[test]
fn types_are_the_chart_categories_in_singular_or_plural() {
    for (text, category) in [
        ("type:video", Category::Video),
        ("type:Videos", Category::Video),
        ("type:image", Category::Images),
        ("type:images", Category::Images),
        ("type:audio", Category::Audio),
        ("type:document", Category::Documents),
        ("type:documents", Category::Documents),
        ("type:archive", Category::Archives),
        ("type:archives", Category::Archives),
        ("type:code", Category::Code),
        ("type:program", Category::Executables),
        ("type:programs", Category::Executables),
        ("type:other", Category::Other),
    ] {
        assert_eq!(filters(text).types, [category], "{text}");
    }
    // Repeated: either, each once.
    let f = filters("type:video type:audio type:VIDEO");
    assert_eq!(f.types, [Category::Video, Category::Audio]);
}

#[test]
fn files_and_folders_are_whole_words_and_the_last_wins() {
    assert_eq!(filters("files").kind, Some(Kind::Files));
    assert_eq!(filters("FOLDERS").kind, Some(Kind::Folders));
    assert_eq!(filters("files folders").kind, Some(Kind::Folders));
    assert_eq!(filters("folders files").kind, Some(Kind::Files));
    is_name_word("file");
    is_name_word("folder");
    is_name_word("filesystem");
}

#[test]
fn repeated_conditions_tighten_each_other() {
    let f = filters(">1MB >2MB <9MB <=5MB");
    assert_eq!((f.min_size, f.max_size), (Some(2 * MB + 1), Some(5 * MB)));
    let f = filters("older:1y older:30d newer:1y newer:30d");
    assert_eq!(
        (f.older_than_days, f.newer_than_days),
        (Some(365), Some(30))
    );
}

#[test]
fn a_half_typed_or_wrong_condition_is_a_name_word() {
    for text in [
        ">",
        "<",
        ">=",
        "<=",
        ">1.",
        ">.5",
        ">1.2.3",
        ">1,",
        ">abc",
        ">1XB",
        ">1G",
        ">-1",
        ">1GB5",
        "1GB",
        "..",
        "100MB..",
        "..1GB",
        "100MB...1GB",
        "1GB..100MB",
        "a..b",
        "<0",
        "<0MB",
        "<0.5",
        "type:",
        "type:foo",
        "type:vid",
        "type",
        "older:",
        "older:1",
        "older:d",
        "older:x",
        "older:1x",
        "older:-1d",
        "older:1.5y",
        "older:99999999999d",
        "older:1d2",
        "newer:",
        "newer:w",
        "newer:abc",
        "older",
        "File",
        "files:",
        "folders1",
        ">=",
    ] {
        let query = Query::parse(text).unwrap();
        assert_eq!(query.filters(), &Filters::default(), "{text}");
        // It is searched as a part of a name.
        let lower = text.to_lowercase();
        // (A word that starts with a dot is an extension, as it was.)
        if query.alternatives.is_empty() {
            assert_eq!(query.words, std::slice::from_ref(&lower), "{text}");
            assert!(query.matches(&format!("x{lower}y"), false), "{text}");
        }
    }
    // A name word next to a condition stays a name word.
    let query = Query::parse("photo >1GB older: ").unwrap();
    assert_eq!(query.words, ["photo", "older:"]);
    assert_eq!(query.filters().min_size, Some(GB + 1));
}

#[test]
fn conditions_alone_make_a_query() {
    for text in [
        ">1GB",
        "older:1y",
        "type:video",
        "folders",
        "files",
        "1MB..2MB",
    ] {
        assert!(Query::parse(text).is_some(), "{text}");
    }
    assert!(Query::parse("  ").is_none());
    // Conditions do not touch the name test.
    assert!(q(">1GB type:video").matches("anything", true));
}
