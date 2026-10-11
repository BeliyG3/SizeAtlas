//! Maps file names to coarse content categories used by the type chart.

use serde::{Deserialize, Serialize};

/// Category value stored on directory nodes.
pub const DIR_CATEGORY: u8 = 255;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Category {
    Video = 0,
    Images = 1,
    Audio = 2,
    Documents = 3,
    Archives = 4,
    Code = 5,
    Executables = 6,
    Other = 7,
}

impl Category {
    /// All categories in `repr` order.
    pub const ALL: [Category; 8] = [
        Category::Video,
        Category::Images,
        Category::Audio,
        Category::Documents,
        Category::Archives,
        Category::Code,
        Category::Executables,
        Category::Other,
    ];
}

/// Returns the category of a file from its extension (case-insensitive).
/// Names without an extension, including dotfiles like `.bashrc`, are `Other`.
pub fn categorize(file_name: &str) -> Category {
    let ext = match file_name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => ext.to_ascii_lowercase(),
        _ => return Category::Other,
    };
    match ext.as_str() {
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "webm" | "m4v" | "flv" | "mpg" | "mpeg"
        | "m2ts" | "3gp" | "vob" => Category::Video,
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "tif" | "tiff" | "webp" | "heic" | "heif"
        | "avif" | "raw" | "cr2" | "cr3" | "nef" | "arw" | "dng" | "svg" | "ico" | "psd"
        | "exr" | "hdr" => Category::Images,
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" | "opus" | "aiff" | "alac"
        | "mid" | "midi" => Category::Audio,
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "ods" | "odp"
        | "rtf" | "txt" | "md" | "epub" | "csv" => Category::Documents,
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "zst" | "iso" | "dmg"
        | "cab" => Category::Archives,
        "rs" | "py" | "js" | "ts" | "tsx" | "jsx" | "c" | "h" | "cpp" | "hpp" | "cs" | "java"
        | "go" | "rb" | "php" | "swift" | "kt" | "html" | "css" | "scss" | "json" | "toml"
        | "yaml" | "yml" | "xml" | "sh" | "ps1" | "sql" => Category::Code,
        "exe" | "dll" | "msi" | "sys" | "so" | "dylib" | "app" | "apk" | "bin" | "com" | "bat"
        | "cmd" | "appimage" | "deb" | "rpm" => Category::Executables,
        _ => Category::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_extension_case_insensitively() {
        assert_eq!(categorize("movie.MKV"), Category::Video);
        assert_eq!(categorize("photo.jpeg"), Category::Images);
        assert_eq!(categorize("song.flac"), Category::Audio);
        assert_eq!(categorize("report.PDF"), Category::Documents);
        assert_eq!(categorize("backup.tar.gz"), Category::Archives);
        assert_eq!(categorize("main.rs"), Category::Code);
        assert_eq!(categorize("setup.exe"), Category::Executables);
    }

    #[test]
    fn names_without_extension_are_other() {
        assert_eq!(categorize("Makefile"), Category::Other);
        assert_eq!(categorize(".bashrc"), Category::Other);
        assert_eq!(categorize("trailing."), Category::Other);
        assert_eq!(categorize("data.unknownext"), Category::Other);
    }

    #[test]
    fn repr_values_are_stable() {
        let values: Vec<u8> = Category::ALL.iter().map(|c| *c as u8).collect();
        assert_eq!(values, (0..8).collect::<Vec<u8>>());
        assert_eq!(Category::ALL[7], Category::Other);
    }
}
