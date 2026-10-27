import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useT } from "../../i18n/react";
import type { Palette } from "../../palette";
import { usePalette, useSettings, useSize } from "../../settings/react";
import type { CityScene, CityTheme, Hover } from "./scene";
import { useCityData } from "./useCityData";
import "./city.css";

const TOOLTIP_DELAY_MS = 150;

interface Props {
  /** The root shown: a change reloads the city and resets the camera. */
  generation: number;
  /** Revision of the tree (throttled by the caller during a scan): a change reloads the city. */
  rev: number;
  selectedId: number;
  onSelect: (id: number, isDir: boolean) => void;
  onFail: (e: unknown) => void;
}

const readTheme = (palette: Palette): CityTheme => ({
  palette,
  background:
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || palette.dirFill,
});

/** The whole root as a 3D city, lit around the selection; the folder tree is its keyboard counterpart. */
export function CityView({ generation, rev, selectedId, onSelect, onFail }: Props) {
  const { t } = useT();
  const sizeText = useSize();
  const palette = usePalette();
  const { resolved } = useSettings();
  const { city, finish } = useCityData(generation, rev, selectedId, onFail);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [scene, setScene] = useState<CityScene | null>(null);
  const [status, setStatus] = useState<"ready" | "failed" | "lost">("ready");
  const [hover, setHover] = useState<Hover | null>(null);
  const [tip, setTip] = useState<{ id: number; name: string; path: string } | null>(null);
  // The scene outlives renders: its callbacks read the current props through this.
  const latest = useRef({ onSelect, palette });
  useEffect(() => {
    latest.current = { onSelect, palette };
  });

  // three loads with the scene, only once the panel shows. A renderer that cannot start (no
  // WebGL 2) leaves the message; one that arrives after unmount is never made.
  useEffect(() => {
    if (!canvas) return;
    let cancelled = false;
    let made: CityScene | null = null;
    import("./scene")
      .then(({ createScene }) => {
        if (cancelled) return;
        made = createScene(canvas, readTheme(latest.current.palette), {
          onHover: setHover,
          onPick: (block) => latest.current.onSelect(block.id, block.isDir),
          onLost: (lost) => setStatus(lost ? "lost" : "ready"),
        });
        setScene(made);
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
      made?.dispose();
      setScene(null);
      setHover(null);
    };
  }, [canvas]);

  // `--bg` follows the theme in effect, set on the document before this runs.
  useEffect(() => {
    scene?.setTheme(readTheme(palette));
  }, [scene, palette, resolved]);

  useEffect(() => {
    if (!scene) return;
    scene.setCity(city, generation);
    finish?.();
  }, [scene, city, generation, finish]);

  // The name and path once the pointer rests on a block: one request per block.
  const hoverId = hover?.block.id ?? null;
  useEffect(() => {
    if (hoverId === null) return;
    let live = true;
    const timer = setTimeout(() => {
      api.getCrumbs(generation, hoverId).then(
        (crumbs) => {
          if (!live) return;
          const names = crumbs.map((c) => c.name);
          const name = names.pop() ?? "";
          setTip({ id: hoverId, name, path: names.join(" › ") });
        },
        (e: unknown) => live && onFail(e),
      );
    }, TOOLTIP_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [hoverId, generation, onFail]);

  if (status === "failed") {
    return (
      <div className="city">
        <p className="city-message dim">{t("city.unavailable")}</p>
      </div>
    );
  }

  const named = hover && tip?.id === hover.block.id ? tip : null;
  const tipStyle = hover && {
    left: hover.x < hover.w / 2 ? hover.x + 14 : undefined,
    right: hover.x >= hover.w / 2 ? hover.w - hover.x + 14 : undefined,
    top: hover.y < hover.h / 2 ? hover.y + 14 : undefined,
    bottom: hover.y >= hover.h / 2 ? hover.h - hover.y + 14 : undefined,
  };

  return (
    <div className="city">
      <canvas
        ref={setCanvas}
        role="img"
        aria-label={t("city.label")}
        style={hover ? { cursor: "pointer" } : undefined}
      />
      <button className="city-reset" disabled={!scene} onClick={() => scene?.reset()}>
        {t("city.reset")}
      </button>
      {status === "lost" && <p className="city-message dim">{t("city.unavailable")}</p>}
      {hover && (
        <div className="city-tip" style={tipStyle ?? undefined}>
          {named && <div dir="auto">{named.name}</div>}
          {named?.path && (
            <div className="dim" dir="auto">
              {named.path}
            </div>
          )}
          <div>
            {t(hover.block.isDir ? "city.folder" : "city.file")} · {sizeText(hover.block.size)}
          </div>
        </div>
      )}
    </div>
  );
}
