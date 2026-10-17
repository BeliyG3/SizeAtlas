//! The native title bar in the app's theme. Windows 11 paints the caption in the colors given
//! here, over the accent color the user may show on title bars; Windows 10 takes only the dark
//! mode flag. Elsewhere the title bar stays as the system draws it. The title names the version.

/// Caption and text colors (0xRRGGBB): `--bg` and `--text` of each theme in theme.css.
// Off Windows only the tests use them.
#[cfg_attr(not(windows), allow(dead_code))]
const DARK: (u32, u32) = (0x18_18_18, 0xe0_e0_e0);
#[cfg_attr(not(windows), allow(dead_code))]
const LIGHT: (u32, u32) = (0xf5_f6_f8, 0x1c_1f_26);

/// `rgb` (0xRRGGBB) as a Win32 COLORREF (0x00BBGGRR).
#[cfg_attr(not(windows), allow(dead_code))]
fn colorref(rgb: u32) -> u32 {
    ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)
}

/// Paints the title bar of `window` dark or light; a failure leaves it as it was.
#[tauri::command]
pub fn set_title_bar(window: tauri::Window, dark: bool) {
    #[cfg(windows)]
    match window.hwnd() {
        Ok(hwnd) => paint(hwnd.0, dark),
        Err(e) => eprintln!("SizeAtlas: no window handle for the title bar: {e}"),
    }
    #[cfg(not(windows))]
    let _ = (window, dark);
}

#[cfg(windows)]
fn paint(hwnd: *mut core::ffi::c_void, dark: bool) {
    use windows_sys::Win32::Graphics::Dwm::{
        DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE, DwmSetWindowAttribute,
    };

    let (caption, text) = if dark { DARK } else { LIGHT };
    let set = |attribute: i32, value: u32| {
        // SAFETY: `hwnd` is this app's live window; `value` outlives the call and its size is
        // passed. The attributes are DWORD/COLORREF/BOOL, all four bytes.
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute as u32,
                (&raw const value).cast(),
                size_of::<u32>() as u32,
            )
        }
    };
    // Windows 10 knows only the dark mode flag; the colors fail there, which changes nothing.
    set(DWMWA_USE_IMMERSIVE_DARK_MODE, u32::from(dark));
    set(DWMWA_CAPTION_COLOR, colorref(caption));
    set(DWMWA_TEXT_COLOR, colorref(text));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colorref_swaps_red_and_blue() {
        assert_eq!(colorref(0x12_34_56), 0x56_34_12);
        assert_eq!(colorref(LIGHT.0), 0xf8_f6_f5);
        assert_eq!(colorref(DARK.0), 0x18_18_18);
    }
}

/// `SizeAtlas <version>`, the version as shown to people (`YEAR.MONTH` for the first release of a
/// month, as in the About dialog), with ` (dev)` for a development build.
pub fn window_title(version: &str, dev: bool) -> String {
    let shown = match version.strip_suffix(".0") {
        Some(rest) if version.split('.').count() == 3 => rest,
        _ => version,
    };
    let suffix = if dev { " (dev)" } else { "" };
    format!("SizeAtlas {shown}{suffix}")
}

#[cfg(test)]
mod title_tests {
    use super::window_title;

    #[test]
    fn the_title_shows_the_version_as_people_see_it() {
        assert_eq!(window_title("2026.10.0", false), "SizeAtlas 2026.10");
        assert_eq!(window_title("2026.10.1", false), "SizeAtlas 2026.10.1");
        assert_eq!(window_title("2026.10.20", false), "SizeAtlas 2026.10.20");
        assert_eq!(window_title("2026.10.1", true), "SizeAtlas 2026.10.1 (dev)");
    }
}
