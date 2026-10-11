import { open } from "@tauri-apps/plugin-dialog";

/** Asks for a folder and passes it to `onScan`; nothing happens if the dialog is cancelled. */
export function chooseFolder(
  onScan: (path: string) => void,
  onError: (e: unknown) => void,
): Promise<void> {
  return open({ directory: true, multiple: false }).then((path) => {
    if (typeof path === "string") onScan(path);
  }, onError);
}
