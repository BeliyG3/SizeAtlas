//! Details of the rows the UI shows, read from disk without holding the tree lock.

use std::path::{Path, PathBuf};

use sizeatlas_core::details;

use crate::dto::{DetailDto, DetailsDto, millis};

/// Most ids one `get_details` call reads; the rest of a longer list is ignored.
pub const MAX_DETAILS: usize = 500;

/// Reads each path; an entry without a path (unknown id, inexact name) or with a read error
/// gets empty fields.
pub fn read_all(generation: u64, entries: Vec<(u32, Option<PathBuf>)>) -> DetailsDto {
    DetailsDto {
        generation,
        items: entries
            .into_iter()
            .map(|(id, path)| describe(id, path.as_deref()))
            .collect(),
    }
}

fn describe(id: u32, path: Option<&Path>) -> DetailDto {
    match path.map(details::read) {
        Some(Ok(d)) => DetailDto {
            id,
            created: d.created.map(millis),
            accessed: d.accessed.map(millis),
            attributes: Some(d.attributes),
            owner: d.owner,
        },
        _ => DetailDto {
            id,
            created: None,
            accessed: None,
            attributes: None,
            owner: None,
        },
    }
}
