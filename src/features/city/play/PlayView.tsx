import { useEffect, useRef, useState } from "react";
import { useT } from "../../../i18n/react";
import type { CitySnapshot } from "../scene";
import { Hud } from "./Hud";
import { makeHud, type HudState } from "./hints";

interface Props {
  /** The world as the panel showed it when the game started. */
  city: CitySnapshot;
  /** The game is over and the window is back from full screen. */
  onExit: () => void;
}

/**
 * The game over the whole window: a modal dialog in the top layer, so the app under it takes no
 * keys or clicks and its own shortcuts stand aside. three loads with the game, on entry.
 */
export function PlayView({ city, onExit }: Props) {
  const { t } = useT();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [hud, setHud] = useState<HudState>(makeHud);
  const latest = useRef(onExit);
  const stopGame = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    latest.current = onExit;
  });

  useEffect(() => {
    const canvas = dialog?.querySelector("canvas");
    if (!dialog || !canvas) return;
    dialog.showModal();
    let cancelled = false;
    const exit = () => latest.current();
    import("./game").then(
      ({ startGame }) => {
        if (!cancelled) stopGame.current = startGame(canvas, city, exit, setHud);
      },
      () => !cancelled && exit(),
    );
    return () => {
      cancelled = true;
      void stopGame.current?.();
      stopGame.current = null;
      dialog.close();
    };
  }, [dialog, city]);

  // The browser may still close the dialog itself (a repeated Esc): that leaves the game too. A
  // close this view made is queued and finds the dialog shown again, or the view gone.
  const onClose = (e: { currentTarget: HTMLDialogElement }) => {
    if (e.currentTarget.open) return;
    const stop = stopGame.current;
    stopGame.current = null;
    void (stop ? stop() : Promise.resolve()).then(() => latest.current());
  };

  return (
    // Esc is the game's: it leaves full screen first, then closes this.
    <dialog ref={setDialog} className="play" onCancel={(e) => e.preventDefault()} onClose={onClose}>
      <canvas aria-label={t("city.label")} />
      <Hud hud={hud} />
      <p className="play-hint">{t("play.exitHint")}</p>
    </dialog>
  );
}
