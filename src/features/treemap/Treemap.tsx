import { useEffect, useRef, useState, type MouseEvent } from "react";
import { api } from "../../api/client";
import { useT } from "../../i18n/react";
import { usePalette, useSize } from "../../settings/react";
import type { MenuTarget } from "../menu/ItemMenu";
import { hitTest, parseTreemap, type TreemapData, type TreemapRect } from "./bytes";
import { drawTreemap } from "./draw";
import { beginRefresh } from "../scan/cadence";
import "./treemap.css";

const RESIZE_DELAY_MS = 100;
const TOOLTIP_DELAY_MS = 150;

interface Props {
  generation: number;
  /** Revision of the tree: a change loads it again. */
  rev: number;
  viewId: number;
  selectedId: number;
  highlight: number | null;
  onSelect: (id: number, isDir: boolean) => void;
  onMenu: (target: MenuTarget) => void;
  onFail: (e: unknown) => void;
}

interface Size {
  w: number;
  h: number;
}

interface Hover {
  rect: TreemapRect;
  x: number;
  y: number;
}

/** Treemap of the current folder. The folder tree is its keyboard-accessible counterpart. */
export function Treemap({
  generation,
  rev,
  viewId,
  selectedId,
  highlight,
  onSelect,
  onMenu,
  onFail,
}: Props) {
  const { t } = useT();
  const sizeText = useSize();
  const palette = usePalette();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [data, setData] = useState<TreemapData | null>(null);
  const batch = useRef<{ data: TreemapData; finish: () => void } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [tip, setTip] = useState<{ id: number; text: string } | null>(null);

  // Follow the box size, waiting until a window resize settles.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      const { width, height } = entry.contentRect;
      timer = setTimeout(
        () => setSize({ w: Math.floor(width), h: Math.floor(height) }),
        RESIZE_DELAY_MS,
      );
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!size) return;
    let live = true;
    const finish = beginRefresh("charts");
    api
      .getTreemap(generation, viewId, size.w, size.h)
      .then((buffer) => {
        const parsed = parseTreemap(buffer);
        if (live && parsed.generation === generation) {
          batch.current = { data: parsed, finish };
          setData(parsed);
        }
      })
      .catch((e: unknown) => {
        if (live) onFail(e);
      });
    return () => {
      live = false;
    };
  }, [generation, rev, viewId, size, onFail]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || !size) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = Math.round(size.w * ratio);
    el.height = Math.round(size.h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawTreemap(ctx, size.w, size.h, data?.rects ?? [], {
      highlight,
      selected: selectedId,
      palette,
    });
    if (batch.current?.data === data) {
      batch.current.finish();
      batch.current = null;
    }
  }, [data, size, highlight, selectedId, palette]);

  // Tooltip: the path from the current folder and the size, once the pointer rests on an item.
  const hoverId = hover?.rect.id ?? null;
  useEffect(() => {
    if (hoverId === null) return;
    let live = true;
    const timer = setTimeout(() => {
      api.getCrumbs(generation, hoverId).then(
        (crumbs) => {
          if (!live) return;
          const below = crumbs.findIndex((c) => c.id === viewId) + 1;
          const last = crumbs[crumbs.length - 1];
          const path = crumbs
            .slice(below)
            .map((c) => c.name)
            .join(" › ");
          setTip({ id: hoverId, text: `${path} — ${sizeText(last.size)}` });
        },
        (e: unknown) => {
          if (live) onFail(e);
        },
      );
    }, TOOLTIP_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [hoverId, generation, viewId, sizeText, onFail]);

  const at = (e: MouseEvent<HTMLCanvasElement>): Hover | null => {
    const bounds = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - bounds.left;
    const y = e.clientY - bounds.top;
    const rect = data && hitTest(data.rects, x, y);
    return rect ? { rect, x, y } : null;
  };

  const tipStyle =
    hover && size
      ? {
          left: hover.x < size.w / 2 ? hover.x + 14 : undefined,
          right: hover.x >= size.w / 2 ? size.w - hover.x + 14 : undefined,
          top: hover.y < size.h / 2 ? hover.y + 14 : undefined,
          bottom: hover.y >= size.h / 2 ? size.h - hover.y + 14 : undefined,
        }
      : undefined;

  return (
    <div className="treemap" ref={box}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={t("treemap.label")}
        style={size ? { width: size.w, height: size.h } : undefined}
        onMouseMove={(e) => setHover(at(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const hit = at(e);
          if (hit) onSelect(hit.rect.id, hit.rect.isDir);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const hit = at(e);
          // Lossy names are unknown here; the backend refuses them with a clear message.
          if (hit) {
            const { id, isDir } = hit.rect;
            onMenu({ id, isDir, lossy: false, x: e.clientX, y: e.clientY });
          }
        }}
      />
      {data?.rects.length === 0 && <p className="treemap-empty dim">{t("treemap.empty")}</p>}
      {tip && hover && tip.id === hover.rect.id && (
        <div className="tooltip" style={tipStyle}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
