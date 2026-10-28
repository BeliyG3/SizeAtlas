import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useT } from "../../i18n/react";
import type { Palette } from "../../palette";
import { usePalette, useSettings, useSize } from "../../settings/react";
import { placePopup } from "../duplicates/viewer/hover";
import type { CityScene, CityTheme, Hover } from "./scene";
import { useCityData } from "./useCityData";
import type { Building } from "./world/buildings";
import "./city.css";

const TOOLTIP_DELAY_MS = 150;
/** Distance between the pointer and the tooltip, px. */
const TIP_GAP = 14;

interface Props {
  /** The root shown: a change reloads the city and resets the camera. */
  generation: number;
  /** Revision of the tree (throttled by the caller during a scan): a change reloads the city. */
  rev: number;
  selectedId: number;
  onSelect: (id: number, isDir: boolean) => void;
  onFail: (e: unknown) => void;
}

/** The folder a building stands for: its own, or for a filler its block's. */
const folderOf = (b: Building) => (b.kind === "filler" ? b.parent : b.id);

const readTheme = (palette: Palette): CityTheme => ({
  palette,
  background:
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || palette.dirFill,
});

/**
 * The whole root as a living 3D island, lit around the selection; the folder tree is its keyboard
 * counterpart.
 */
export function CityView({ generation, rev, selectedId, onSelect, onFail }: Props) {
  const { t } = useT();
  const sizeText = useSize();
  const palette = usePalette();
  const { resolved } = useSettings();
  const { world, finish } = useCityData(generation, rev, selectedId, onFail);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [scene, setScene] = useState<CityScene | null>(null);
  const [status, setStatus] = useState<"ready" | "failed" | "lost">("ready");
  const [hover, setHover] = useState<Hover | null>(null);
  const [tip, setTip] = useState<{
    generation: number;
    id: number;
    name: string;
    path: string;
  } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
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
          onPick: (building) => latest.current.onSelect(folderOf(building), true),
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
    scene.setCity(world, generation);
    finish?.();
  }, [scene, world, generation, finish]);

  // The name and path once the pointer rests on a building: one request per folder.
  const hoverId = hover ? folderOf(hover.building) : null;
  useEffect(() => {
    if (hoverId === null) return;
    let live = true;
    const timer = setTimeout(() => {
      api.getCrumbs(generation, hoverId).then(
        (crumbs) => {
          if (!live) return;
          const names = crumbs.map((c) => c.name);
          const name = names.pop() ?? "";
          setTip({ generation, id: hoverId, name, path: names.join(" › ") });
        },
        (e: unknown) => live && onFail(e),
      );
    }, TOOLTIP_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [hoverId, generation, onFail]);

  // Beside the pointer, flipped and clamped so the whole tip stays inside the panel. Measured at
  // the corner first, where the panel edge does not narrow it.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !hover) return;
    el.style.left = el.style.top = "0px";
    const size = { w: el.offsetWidth, h: el.offsetHeight };
    const { x, y } = placePopup(hover, size, { w: hover.w, h: hover.h }, TIP_GAP);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });

  if (status === "failed") {
    return (
      <div className="city">
        <p className="city-message dim">{t("city.unavailable")}</p>
      </div>
    );
  }

  const named = tip?.id === hoverId && tip.generation === generation ? tip : null;

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
      {status === "ready" && !world && <p className="city-message dim">{t("city.building")}</p>}
      {hover && (
        <div className="city-tip" ref={tipRef}>
          {named && <div dir="auto">{named.name}</div>}
          {named?.path && (
            <div className="dim" dir="auto">
              {named.path}
            </div>
          )}
          <div>
            {t(hover.building.kind === "filler" ? "city.others" : "city.folder")} ·{" "}
            {sizeText(hover.building.size)}
          </div>
        </div>
      )}
    </div>
  );
}
