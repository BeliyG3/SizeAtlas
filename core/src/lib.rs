//! Core of SizeAtlas: directory scanning, the flat size tree and its on-disk cache.

pub mod baseline;
pub mod cache;
pub mod categories;
pub mod cleanup;
pub mod details;
mod platform;
pub mod scanner;
pub mod tree;
pub mod treemap;

pub use platform::can_recycle;
