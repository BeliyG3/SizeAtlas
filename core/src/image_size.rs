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
const ICO: &[u8] = &[0, 0, 1, 0];

fn is_gif(d: &[u8]) -> bool {
    d.starts_with(b"GIF87a") || d.starts_with(b"GIF89a")
}

fn is_webp(d: &[u8]) -> bool {
    d.starts_with(b"RIFF") && d.get(8..12) == Some(b"WEBP")
}

/// The content starts like a PNG, JPEG, GIF, WebP, BMP or ICO file.
pub fn has_signature(d: &[u8]) -> bool {
    [PNG, JPEG, b"BM", ICO].iter().any(|s| d.starts_with(s)) || is_gif(d) || is_webp(d)
}

/// Width times height of the image in `data`, from its header; `None` when the format is
/// unknown, the header is cut or a side is 0. An ICO counts its largest entry (the directory,
/// and the PNG inside an entry).
pub fn pixels(data: &[u8]) -> Option<u64> {
    let (w, h) = if data.starts_with(PNG) {
        png(data)?
    } else if data.starts_with(JPEG) {
        jpeg(data)?
    } else if is_gif(data) {
        (u32::from(le16(data, 6)?), u32::from(le16(data, 8)?))
    } else if is_webp(data) {
        webp(data)?
    } else if data.starts_with(b"BM") {
        bmp(data)?
    } else if data.starts_with(ICO) {
        return ico(data);
    } else {
        return None;
    };
    (w > 0 && h > 0).then(|| u64::from(w) * u64::from(h))
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

fn bmp(d: &[u8]) -> Option<(u32, u32)> {
    match le32(d, 14)? {
        // The old OS/2 header: 16-bit sides.
        12 => Some((u32::from(le16(d, 18)?), u32::from(le16(d, 20)?))),
        40.. => Some((
            le32(d, 18)?.cast_signed().unsigned_abs(),
            le32(d, 22)?.cast_signed().unsigned_abs(),
        )),
        _ => None,
    }
}

/// The largest entry of the directory; an entry that holds a PNG counts as that PNG says.
fn ico(d: &[u8]) -> Option<u64> {
    let count = usize::from(le16(d, 4)?);
    (0..count)
        .map(|i| {
            let e = 6 + 16 * i;
            let side = |b: u8| if b == 0 { 256 } else { u64::from(b) };
            let inner = le32(d, e + 12).and_then(|at| d.get(at as usize..));
            match inner.filter(|x| x.starts_with(PNG)) {
                Some(x) => pixels(x),
                None => Some(side(*d.get(e)?) * side(*d.get(e + 1)?)),
            }
        })
        .try_fold(0, |most: u64, p| p.map(|p| most.max(p)))
        .filter(|&p| p > 0)
}

#[cfg(test)]
mod tests;
