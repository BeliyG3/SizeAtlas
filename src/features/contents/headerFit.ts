import { useEffect, useState, type RefObject } from "react";
import { useT } from "../../i18n/react";
import { fitWidth } from "../columns/fit";
import { DEFAULT_WIDTHS, type Widths } from "./columns";

/** Padding of a header label (6px on each side) and the gap before its sort arrow. */
const LABEL_ROOM = 16;

/**
 * The defaults, each widened where needed so that its header label, `label(id)` pixels wide,
 * shows in full next to a sort arrow `arrow` pixels wide.
 */
export function headerWidths<K extends string>(
  defaults: Readonly<Record<K, number>>,
  label: (id: K) => number,
  arrow: number,
): Record<K, number> {
  const widths = {} as Record<K, number>;
  for (const id of Object.keys(defaults) as K[]) {
    widths[id] = Math.max(defaults[id], fitWidth(label(id) + LABEL_ROOM + arrow));
  }
  return widths;
}

/**
 * Default widths of the table under `body` that fit its header labels in the current language
 * (see `headerWidths`); undefined until measured.
 */
export function useHeaderWidths(body: RefObject<HTMLElement | null>): Widths | undefined {
  const { t } = useT();
  const [fitted, setFitted] = useState<Widths>();
  useEffect(() => {
    const label = body.current?.querySelector<HTMLElement>(".chead .ellipsis");
    const context = label && document.createElement("canvas").getContext("2d");
    if (!label || !context) return;
    let live = true;
    // Once the fonts are in: a fallback font has other widths.
    void document.fonts.ready.then(() => {
      if (!live) return;
      const style = getComputedStyle(label);
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const width = (text: string) => context.measureText(text).width;
      setFitted(headerWidths(DEFAULT_WIDTHS, (id) => width(t(`col.${id}`)), width("▼")));
    });
    return () => {
      live = false;
    };
  }, [body, t]);
  return fitted;
}
