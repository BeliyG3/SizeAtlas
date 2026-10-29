import { useEffect, useRef, useState } from "react";
import { useT } from "../../../i18n/react";
import type { CitySnapshot } from "../scene";

export interface PlayStart {
  city: CitySnapshot;
  /** The sky: the page background when the game started. */
  background: string;
}

interface Props {
  start: PlayStart;
  /** The game is over and the window is back from full screen. */
  onExit: () => void;
}

/**
 * The game over the whole window: a modal dialog in the top layer, so the app under it takes no
 * keys or clicks and its own shortcuts stand aside. three loads with the game, on entry.
 */
export function PlayView({ start, onExit }: Props) {
  const { t } = useT();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const latest = useRef(onExit);
  useEffect(() => {
    latest.current = onExit;
  });

  useEffect(() => {
    const canvas = dialog?.querySelector("canvas");
    if (!dialog || !canvas) return;
    dialog.showModal();
    let cancelled = false;
    let stop: (() => void) | null = null;
    const exit = () => latest.current();
    import("./game").then(
      ({ startGame }) => {
        if (!cancelled) stop = startGame(canvas, start.city, start.background, exit);
      },
      () => !cancelled && exit(),
    );
    return () => {
      cancelled = true;
      stop?.();
      dialog.close();
    };
  }, [dialog, start]);

  return (
    // Esc is the game's: it leaves full screen first, then closes this.
    <dialog ref={setDialog} className="play" onCancel={(e) => e.preventDefault()}>
      <canvas aria-label={t("city.label")} />
      <p className="play-hint">{t("play.exitHint")}</p>
    </dialog>
  );
}
