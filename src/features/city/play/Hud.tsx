import { useT } from "../../../i18n/react";
import { hintKeys, type HudState } from "./hints";

/** The game's overlay: the key hints for what the player can do now. */
export function Hud({ hud }: { hud: HudState }) {
  const { t } = useT();
  return (
    <>
      {/* Room for the stars, health and durability of later stages. */}
      <div className="play-status" />
      <p className="play-hud" aria-live="polite">
        {hintKeys(hud).map((key) => (
          <span key={key}>{t(key)}</span>
        ))}
      </p>
    </>
  );
}
