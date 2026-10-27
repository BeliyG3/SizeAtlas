//! The size of an image read from the start of its file, so that a thumbnail is never decoded
//! for a picture that would take gigabytes (a decompression bomb). The format comes from the
//! content, not from the name.

/// Extensions the webview shows in an `<img>`.
pub const THUMB_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "avif",
];
/// The largest file read for a thumbnail.
pub const MAX_THUMB_BYTES: u64 = 32 << 20;
/// The most pixels a thumbnail may decode.
pub const MAX_PIXELS: u64 = 40_000_000;

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";
const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF];
/// An icon file; a cursor (`CUR`) has the same layout.
const ICO: &[u8] = &[0, 0, 1, 0];
const CUR: &[u8] = &[0, 0, 2, 0];

fn is_gif(d: &[u8]) -> bool {
    d.starts_with(b"GIF87a") || d.starts_with(b"GIF89a")
}

fn is_webp(d: &[u8]) -> bool {
    d.starts_with(b"RIFF") && d.get(8..12) == Some(b"WEBP")
}

fn is_icon(d: &[u8]) -> bool {
    d.starts_with(ICO) || d.starts_with(CUR)
}

/// The content starts like a PNG, JPEG, GIF, WebP, BMP, ICO or CUR file.
pub fn has_signature(d: &[u8]) -> bool {
    [PNG, JPEG, b"BM"].iter().any(|s| d.starts_with(s)) || is_gif(d) || is_webp(d) || is_icon(d)
}

/// Width times height of the image in `data`, from its header; `None` when the format is
/// unknown, the header is cut or a side is 0. A GIF counts the larger of its screen and its
/// first frame, an ICO or CUR its largest entry (the directory, the header of a bitmap or the
/// PNG inside an entry).
pub fn pixels(data: &[u8]) -> Option<u64> {
    let area = |(w, h): (u32, u32)| u64::from(w) * u64::from(h);
    let found = if data.starts_with(PNG) {
        png(data).map(area)
    } else if data.starts_with(JPEG) {
        jpeg(data).map(area)
    } else if is_gif(data) {
        gif(data)
    } else if is_webp(data) {
        webp(data).map(area)
    } else if data.starts_with(b"BM") {
        dib(data, 14).map(area)
    } else if is_icon(data) {
        ico(data)
    } else {
        None
    };
    found.filter(|&p| p > 0)
}

fn le16(d: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(d.get(at..at + 2)?.try_into().ok()?))
}

fn le24(d: &[u8], at: usize) -> Option<u32> {
    let b = d.get(at..at + 3)?;
    Some(u32::from_le_bytes([b[0], b[1], b[2], 0]))
}

fn le32(d: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(d.get(at..at + 4)?.try_into().ok()?))
}

fn be16(d: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(d.get(at..at + 2)?.try_into().ok()?))
}

fn png(d: &[u8]) -> Option<(u32, u32)> {
    if d.get(12..16)? != b"IHDR" {
        return None;
    }
    let side = |at: usize| Some(u32::from_be_bytes(d.get(at..at + 4)?.try_into().ok()?));
    Some((side(16)?, side(20)?))
}

/// Walks the segments to the first frame header (`SOF0..SOF15` but `DHT`, `JPG`, `DAC`).
fn jpeg(d: &[u8]) -> Option<(u32, u32)> {
    let mut at = 2;
    loop {
        if *d.get(at)? != 0xFF {
            return None;
        }
        // Any number of 0xFF fill bytes may precede a marker.
        while *d.get(at + 1)? == 0xFF {
            at += 1;
        }
        let marker = *d.get(at + 1)?;
        at += 2;
        match marker {
            // Standalone markers (TEM, RSTn, SOI) have no length.
            0x01 | 0xD0..=0xD8 => {}
            // The end or the scan comes before any frame: no size.
            0xD9 | 0xDA => return None,
            0xC0..=0xCF if !matches!(marker, 0xC4 | 0xC8 | 0xCC) => {
                return Some((u32::from(be16(d, at + 5)?), u32::from(be16(d, at + 3)?)));
            }
            _ => at += usize::from(be16(d, at)?),
        }
    }
}

fn webp(d: &[u8]) -> Option<(u32, u32)> {
    match d.get(12..16)? {
        b"VP8X" => Some((le24(d, 24)? + 1, le24(d, 27)? + 1)),
        b"VP8L" => {
            let bits = le32(d, 21)?;
            (*d.get(20)? == 0x2F).then_some(((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1))
        }
        b"VP8 " => {
            let side = |at| le16(d, at).map(|v| u32::from(v & 0x3FFF));
            (d.get(23..26)? == [0x9D, 0x01, 0x2A]).then_some((side(26)?, side(28)?))
        }
        _ => None,
    }
}

/// The sides in a bitmap info header at `at` (a BMP file: 14; the data of an icon entry: 0).
fn dib(d: &[u8], at: usize) -> Option<(u32, u32)> {
    match le32(d, at)? {
        // The old OS/2 header: 16-bit sides.
        12 => Some((u32::from(le16(d, at + 4)?), u32::from(le16(d, at + 6)?))),
        40.. => Some((
            le32(d, at + 4)?.cast_signed().unsigned_abs(),
            le32(d, at + 8)?.cast_signed().unsigned_abs(),
        )),
        _ => None,
    }
}

/// The larger of the logical screen and the first frame: a decoder may grow the screen to a
/// frame that does not fit it. The walk stops at the first image descriptor; none, or a cut
/// block, gives `None`.
fn gif(d: &[u8]) -> Option<u64> {
    let area = |w: u16, h: u16| u64::from(w) * u64::from(h);
    let screen = area(le16(d, 6)?, le16(d, 8)?);
    let packed = *d.get(10)?;
    // The global colour table, when there is one, follows the 7 bytes of the screen.
    let mut at = 13
        + if packed & 0x80 != 0 {
            3 << ((packed & 7) + 1)
        } else {
            0
        };
    loop {
        match *d.get(at)? {
            0x2C => return Some(screen.max(area(le16(d, at + 5)?, le16(d, at + 7)?))),
            // An extension: introducer, label, then sub-blocks up to an empty one.
            0x21 => {
                at += 2;
                loop {
                    let n = usize::from(*d.get(at)?);
                    at += 1 + n;
                    if n == 0 {
                        break;
                    }
                }
            }
            _ => return None,
        }
    }
}

/// The largest entry of the directory: the larger of the size it lists, the size in the bitmap
/// header of its data, and (for a PNG) the size the PNG says. An entry the PNG of which is cut
/// gives `None`; data out of the file leaves the listed size.
fn ico(d: &[u8]) -> Option<u64> {
    let count = usize::from(le16(d, 4)?);
    (0..count)
        .map(|i| {
            let e = 6 + 16 * i;
            let side = |b: u8| if b == 0 { 256 } else { u64::from(b) };
            let listed = side(*d.get(e)?) * side(*d.get(e + 1)?);
            let data = le32(d, e + 12).and_then(|at| d.get(at as usize..));
            let inner = match data {
                Some(x) if x.starts_with(PNG) => pixels(x)?,
                Some(x) => dib(x, 0).map_or(0, |(w, h)| u64::from(w) * u64::from(h)),
                None => 0,
            };
            Some(listed.max(inner))
        })
        .try_fold(0, |most: u64, p| p.map(|p| most.max(p)))
        .filter(|&p| p > 0)
}

#[cfg(test)]
mod tests;
