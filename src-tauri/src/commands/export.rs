//! File › Export table: the UI builds the CSV text, this asks where to save it with the native
//! Save dialog and writes it. The dialog is opened here, so the UI needs no dialog permission.

use std::path::Path;

use tauri::Window;
use tauri_plugin_dialog::DialogExt;

use crate::error::CmdError;

/// Excel reads a CSV file as UTF-8 only when it starts with a byte order mark.
const BOM: &str = "\u{feff}";

fn io(path: &Path, e: impl ToString) -> CmdError {
    CmdError::Io {
        path: path.display().to_string(),
        os_message: e.to_string(),
    }
}

/// Writes `text` to `path` as UTF-8 with a BOM; a failure carries the system's message.
fn write_csv(path: &Path, text: &str) -> Result<(), CmdError> {
    std::fs::write(path, [BOM, text].concat()).map_err(|e| io(path, e))
}

/// Asks where to save `text`, suggesting `suggested_name`, and writes it there. The name of the
/// saved file, or `None` if the dialog was cancelled.
#[tauri::command]
pub async fn export_table(
    window: Window,
    suggested_name: String,
    text: String,
) -> Result<Option<String>, CmdError> {
    let dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(suggested_name)
        .add_filter("CSV", &["csv"]);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(chosen) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(|e| io(Path::new(""), e))?;
        write_csv(&path, &text)?;
        Ok(Some(path.file_name().map_or_else(
            || path.display().to_string(),
            |n| n.to_string_lossy().into_owned(),
        )))
    })
    .await
    .map_err(CmdError::from)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_bom_then_the_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.csv");
        write_csv(&path, "Name;Größe\r\n").unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..3], b"\xEF\xBB\xBF");
        assert_eq!(&bytes[3..], "Name;Größe\r\n".as_bytes());
    }

    #[test]
    fn a_failed_write_carries_the_system_message() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("t.csv");
        match write_csv(&path, "x") {
            Err(CmdError::Io { os_message, .. }) => assert!(!os_message.is_empty()),
            other => panic!("expected an Io error, got {other:?}"),
        }
    }
}
