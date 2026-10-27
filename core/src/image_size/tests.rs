use super::*;

fn png(w: u32, h: u32) -> Vec<u8> {
    let mut d = b"\x89PNG\r\n\x1a\n".to_vec();
    d.extend([0, 0, 0, 13]);
    d.extend(b"IHDR");
    d.extend(w.to_be_bytes());
    d.extend(h.to_be_bytes());
    d.extend([8, 6, 0, 0, 0]);
    d
}

fn riff(chunk: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut d = b"RIFF\0\0\0\0WEBP".to_vec();
    d.extend(chunk);
    d.extend((body.len() as u32).to_le_bytes());
    d.extend(body);
    d
}

/// A GIF with a screen of `screen` and, after a colour table and a comment, a frame of `frame`.
fn gif(screen: (u16, u16), frame: (u16, u16)) -> Vec<u8> {
    let mut d = b"GIF89a".to_vec();
    d.extend(screen.0.to_le_bytes());
    d.extend(screen.1.to_le_bytes());
    // Global table of 2 colours, then a comment block of 3 bytes.
    d.extend([0x80, 0, 0, 1, 2, 3, 4, 5, 6]);
    d.extend([0x21, 0xFE, 3, 0x61, 0x62, 0x63, 0]);
    d.extend([0x2C, 0, 0, 0, 0]);
    d.extend(frame.0.to_le_bytes());
    d.extend(frame.1.to_le_bytes());
    d.push(0);
    d
}

fn webp_x(w: u32, h: u32) -> Vec<u8> {
    let mut x = vec![0u8; 10];
    x[4..7].copy_from_slice(&(w - 1).to_le_bytes()[..3]);
    x[7..10].copy_from_slice(&(h - 1).to_le_bytes()[..3]);
    riff(b"VP8X", &x)
}

fn webp_l(w: u32, h: u32) -> Vec<u8> {
    let mut l = vec![0x2F];
    l.extend(((w - 1) | ((h - 1) << 14)).to_le_bytes());
    riff(b"VP8L", &l)
}

fn webp_lossy(w: u16, h: u16) -> Vec<u8> {
    let mut lossy = vec![0u8; 3];
    lossy.extend([0x9D, 0x01, 0x2A]);
    lossy.extend(w.to_le_bytes());
    lossy.extend(h.to_le_bytes());
    riff(b"VP8 ", &lossy)
}

fn bmp(w: i32, h: i32) -> Vec<u8> {
    let mut d = b"BM".to_vec();
    d.extend([0u8; 12]);
    d.extend(40u32.to_le_bytes());
    d.extend(w.to_le_bytes());
    d.extend(h.to_le_bytes());
    d
}

/// A file of one entry: `kind` 1 is an icon, 2 a cursor; the data comes after the directory.
fn icon(kind: u8, listed: (u8, u8), data: &[u8]) -> Vec<u8> {
    let mut d = vec![0, 0, kind, 0, 1, 0, listed.0, listed.1, 0, 0, 1, 0, 32, 0];
    d.extend((data.len() as u32).to_le_bytes());
    d.extend(22u32.to_le_bytes());
    d.extend(data);
    d
}

#[test]
fn png_size_comes_from_ihdr() {
    assert_eq!(pixels(&png(100, 50)), Some(5000));
}

#[test]
fn jpeg_size_comes_from_sof_after_exif() {
    let mut d = vec![0xFF, 0xD8, 0xFF, 0xE1];
    d.extend(2002u16.to_be_bytes());
    d.extend(vec![0u8; 2000]);
    // A table (DHT, C4) is not a frame; the frame follows it.
    d.extend([0xFF, 0xC4, 0, 4, 0, 0]);
    let before_frame = d.len();
    d.extend([0xFF, 0xC0, 0, 11, 8]);
    d.extend(480u16.to_be_bytes());
    d.extend(640u16.to_be_bytes());
    d.extend([3, 0, 0, 0]);
    assert_eq!(pixels(&d), Some(307_200));
    // The scan comes before any frame: no size.
    d.truncate(before_frame);
    d.extend([0xFF, 0xDA, 0, 2]);
    assert_eq!(pixels(&d), None);
}

#[test]
fn a_jpeg_may_have_fill_bytes_and_restart_markers_before_the_frame() {
    let mut d = vec![0xFF, 0xD8, 0xFF, 0xFF, 0xFF, 0xD0, 0xFF, 0x01];
    d.extend([0xFF, 0xC2, 0, 11, 8]);
    d.extend(30u16.to_be_bytes());
    d.extend(40u16.to_be_bytes());
    d.extend([3, 0, 0, 0]);
    assert_eq!(pixels(&d), Some(1200));
}

#[test]
fn gif_webp_and_bmp_sizes() {
    assert_eq!(pixels(&gif((10, 20), (10, 20))), Some(200));
    assert_eq!(pixels(&webp_x(1000, 2000)), Some(2_000_000));
    assert_eq!(pixels(&webp_l(300, 200)), Some(60_000));
    assert_eq!(pixels(&webp_lossy(64, 48)), Some(3072));
    assert_eq!(pixels(&bmp(10, -20)), Some(200));
}

#[test]
fn a_gif_counts_its_first_frame_when_it_is_larger_than_the_screen() {
    assert_eq!(pixels(&gif((1, 1), (8000, 6000))), Some(48_000_000));
    assert_eq!(pixels(&gif((8000, 6000), (1, 1))), Some(48_000_000));
    // No frame: nothing to show.
    let mut none = gif((10, 10), (10, 10));
    none.truncate(none.len() - 10);
    assert_eq!(pixels(&none), None);
}

#[test]
fn ico_size_comes_from_the_directory_or_the_inner_png() {
    assert_eq!(pixels(&icon(1, (32, 16), &[])), Some(512));
    // 0 in the directory means 256.
    assert_eq!(pixels(&icon(1, (0, 0), &[])), Some(65_536));
    assert_eq!(
        pixels(&icon(1, (16, 16), &png(4000, 3000))),
        Some(12_000_000)
    );
}

#[test]
fn a_cursor_is_read_like_an_icon() {
    let bomb = icon(2, (16, 16), &png(8000, 6000));
    assert!(has_signature(&bomb));
    assert_eq!(pixels(&bomb), Some(48_000_000));
}

#[test]
fn an_icon_entry_with_a_bitmap_counts_the_bitmap_header_when_it_is_larger() {
    // A DIB header is the same as in a BMP file, without the 14 bytes before it.
    let big = bmp(4000, 3000);
    assert_eq!(pixels(&icon(1, (16, 16), &big[14..])), Some(12_000_000));
    let small = bmp(8, 8);
    assert_eq!(pixels(&icon(1, (16, 16), &small[14..])), Some(256));
}

#[test]
fn an_icon_with_no_entries_or_data_out_of_the_file() {
    let mut empty = icon(1, (1, 1), &[]);
    empty[4] = 0;
    assert!(has_signature(&empty));
    assert_eq!(pixels(&empty), None);
    // The offset of the data lies past the end: the listed size stands.
    let mut far = icon(1, (32, 32), &[]);
    far[18..22].copy_from_slice(&1_000_000u32.to_le_bytes());
    assert_eq!(pixels(&far), Some(1024));
}

#[test]
fn a_cut_header_has_no_size() {
    assert_eq!(pixels(&png(100, 50)[..8]), None);
    assert_eq!(pixels(&[0xFF, 0xD8, 0xFF]), None);
    assert_eq!(pixels(b"GIF89a\x01"), None);
    assert_eq!(pixels(&[0, 0, 1, 0, 1, 0]), None);
    assert_eq!(pixels(b"not an image at all"), None);
    assert_eq!(pixels(&png(0, 50)), None);
}

/// Cutting a file anywhere never panics and never gives a size larger than the whole file's:
/// either nothing or what the cut part already says (an icon entry cut off lists its own size).
#[test]
fn every_cut_of_a_valid_file_is_safe() {
    let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE1, 0, 6, 1, 2, 3, 4];
    jpeg.extend([0xFF, 0xC0, 0, 11, 8, 0, 30, 0, 40, 3, 0, 0, 0]);
    let dib = bmp(40, 30);
    let samples = [
        png(100, 50),
        jpeg,
        gif((10, 20), (10, 20)),
        webp_x(1000, 2000),
        webp_l(300, 200),
        webp_lossy(64, 48),
        bmp(10, -20),
        icon(1, (16, 16), &png(400, 300)),
        icon(2, (16, 16), &dib[14..]),
    ];
    for whole in samples {
        let size = pixels(&whole);
        assert!(size.is_some());
        for n in 0..whole.len() {
            let cut = pixels(&whole[..n]);
            assert!(cut.is_none() || cut <= size, "{whole:02x?} cut at {n}");
        }
    }
}

#[test]
fn only_the_known_signatures_are_images() {
    assert!(has_signature(&png(1, 1)[..8]));
    assert!(has_signature(&[0, 0, 1, 0]));
    assert!(has_signature(&[0, 0, 2, 0]));
    assert!(!has_signature(&[0, 0, 3, 0]));
    assert!(!has_signature(
        b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"
    ));
    assert!(!has_signature(b""));
}
