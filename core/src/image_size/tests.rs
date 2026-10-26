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
fn gif_webp_and_bmp_sizes() {
    let mut gif = b"GIF89a".to_vec();
    gif.extend(10u16.to_le_bytes());
    gif.extend(20u16.to_le_bytes());
    assert_eq!(pixels(&gif), Some(200));

    let mut x = vec![0u8; 10];
    x[4..7].copy_from_slice(&(1000u32 - 1).to_le_bytes()[..3]);
    x[7..10].copy_from_slice(&(2000u32 - 1).to_le_bytes()[..3]);
    assert_eq!(pixels(&riff(b"VP8X", &x)), Some(2_000_000));

    let bits = (300u32 - 1) | ((200u32 - 1) << 14);
    let mut l = vec![0x2F];
    l.extend(bits.to_le_bytes());
    assert_eq!(pixels(&riff(b"VP8L", &l)), Some(60_000));

    let mut lossy = vec![0u8; 3];
    lossy.extend([0x9D, 0x01, 0x2A]);
    lossy.extend(64u16.to_le_bytes());
    lossy.extend(48u16.to_le_bytes());
    assert_eq!(pixels(&riff(b"VP8 ", &lossy)), Some(3072));

    let mut bmp = b"BM".to_vec();
    bmp.extend([0u8; 12]);
    bmp.extend(40u32.to_le_bytes());
    bmp.extend(10i32.to_le_bytes());
    bmp.extend((-20i32).to_le_bytes());
    assert_eq!(pixels(&bmp), Some(200));
}

#[test]
fn ico_size_comes_from_the_directory_or_the_inner_png() {
    let dir = |w: u8, h: u8, len: u32, at: u32| {
        let mut d = vec![0, 0, 1, 0, 1, 0, w, h, 0, 0, 1, 0, 32, 0];
        d.extend(len.to_le_bytes());
        d.extend(at.to_le_bytes());
        d
    };
    assert_eq!(pixels(&dir(32, 16, 0, 22)), Some(512));
    // 0 in the directory means 256.
    assert_eq!(pixels(&dir(0, 0, 0, 22)), Some(65_536));
    let inner = png(4000, 3000);
    let mut d = dir(16, 16, inner.len() as u32, 22);
    d.extend(inner);
    assert_eq!(pixels(&d), Some(12_000_000));
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

#[test]
fn only_the_known_signatures_are_images() {
    assert!(has_signature(&png(1, 1)[..8]));
    assert!(has_signature(&[0, 0, 1, 0]));
    assert!(!has_signature(
        b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"
    ));
    assert!(!has_signature(b""));
}
