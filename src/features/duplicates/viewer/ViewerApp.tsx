import type { UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { api } from "../../../api/client";
import { useT } from "../../../i18n/react";
import { mimeOf } from "../thumbs";
import { onViewerShow, viewerReady, type ViewerPicture } from "./viewerWindow";
import { ZoomView } from "./ZoomView";
import "./viewer.css";

interface Shown {
  url: string;
  name: string;
}

/**
 * The page of the viewer window: only the picture of the group selected in the main window, or
 * a hint. No menu and no app around it: Exit and the restart close the window they run in.
 */
export function ViewerApp() {
  const { t } = useT();
  const [shown, setShown] = useState<Shown | null>(null);
  // The URL the webview could not decode.
  const [broken, setBroken] = useState<string | null>(null);
  const title = t("dup.view.title");
  useEffect(() => {
    if (typeof document !== "undefined") document.title = title;
  }, [title]);
  useEffect(() => {
    let off = false;
    let un: UnlistenFn | undefined;
    // The last picture sent; one read in flight at most, and only the latest one waits behind it.
    let latest: ViewerPicture | null = null;
    let busy = false;
    let waiting: ViewerPicture | null = null;
    let url: string | null = null;
    const put = (next: Shown | null) => {
      if (url) URL.revokeObjectURL(url);
      url = next?.url ?? null;
      setShown(next);
    };
    const read = (p: ViewerPicture) => {
      busy = true;
      api
        .getThumbnail(p.ref)
        // A stale generation, a file gone: nothing to show.
        .catch(() => new ArrayBuffer(0))
        .then((bytes) => {
          busy = false;
          if (off) return;
          if (latest === p) {
            const type = mimeOf(p.name) ?? "";
            const made = bytes.byteLength > 0 && URL.createObjectURL(new Blob([bytes], { type }));
            put(made ? { url: made, name: p.name } : null);
          }
          const next = waiting;
          waiting = null;
          if (next) read(next);
        });
    };
    onViewerShow((p) => {
      latest = p;
      waiting = null;
      if (!p) put(null);
      else if (busy) waiting = p;
      else read(p);
    }).then((u) => {
      if (off) return u();
      un = u;
      // Listening now: ask the main window for the picture instead of waiting for a change.
      void viewerReady().catch(() => {});
    });
    return () => {
      off = true;
      un?.();
      put(null);
    };
  }, []);

  const url = shown && shown.url !== broken ? shown.url : null;
  return (
    <div className="viewer-app">
      {url ? (
        <ZoomView url={url} label={shown?.name ?? ""} onError={() => setBroken(url)} />
      ) : (
        <p className="viewer-empty dim">{t("dup.view.empty")}</p>
      )}
    </div>
  );
}
