/** Gamepad reading for the play mode: which pad counts, and its face buttons as edges. */

/** A connected pad in the standard layout: sticks (y down is positive), triggers 0..1, held buttons. */
export interface PadState {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  rt: number;
  lt: number;
  rb: boolean;
  lb: boolean;
  /** Left stick click. */
  l3: boolean;
  /** The west face button (X). */
  x: boolean;
}

/** Names the pad's edges take in the `pressed` set. */
export const PAD_A = "PadA";
export const PAD_B = "PadB";
export const PAD_START = "PadStart";

/** Tilt or trigger travel that counts as the pad being in use. */
const ACTIVE = 0.15;

export interface PadReader {
  /** Fills `out` from the pad in use and adds its new presses to `pressed`; null if none. */
  read(out: PadState, pressed: Set<string>): PadState | null;
  /** Forgets which buttons were held: the next read starts from the buttons as they are. */
  reset(): void;
}

function hasInput(p: Gamepad): boolean {
  for (let i = 0; i < p.axes.length; i++) if (Math.abs(p.axes[i]) > ACTIVE) return true;
  for (let i = 0; i < p.buttons.length; i++) {
    if (p.buttons[i].pressed || p.buttons[i].value > ACTIVE) return true;
  }
  return false;
}

export function createPadReader(): PadReader {
  let active = -1;
  let a = false;
  let b = false;
  let start = false;

  return {
    reset() {
      active = -1;
    },
    read(out, pressed) {
      const pads = navigator.getGamepads?.();
      let best: Gamepad | null = null;
      let bestScore = -1;
      let bestAt = -1;
      for (let i = 0; pads && i < pads.length; i++) {
        const p = pads[i];
        if (!p || !p.connected) continue;
        // Standard layout first, then one being used, then the one already in use (no flip-flop).
        const score =
          (p.mapping === "standard" ? 4 : 0) + (hasInput(p) ? 2 : 0) + (i === active ? 1 : 0);
        if (score > bestScore || (score === bestScore && best && p.timestamp > best.timestamp)) {
          best = p;
          bestAt = i;
          bestScore = score;
        }
      }
      if (!best) {
        // Unplugged: the next pad starts clean.
        active = -1;
        return null;
      }
      const v = best.buttons;
      out.lx = best.axes[0] ?? 0;
      out.ly = best.axes[1] ?? 0;
      out.rx = best.axes[2] ?? 0;
      out.ry = best.axes[3] ?? 0;
      out.lt = v[6]?.value ?? 0;
      out.rt = v[7]?.value ?? 0;
      out.lb = !!v[4]?.pressed;
      out.rb = !!v[5]?.pressed;
      out.l3 = !!v[10]?.pressed;
      out.x = !!v[2]?.pressed;
      const na = !!v[0]?.pressed;
      const nb = !!v[1]?.pressed;
      const ns = !!v[9]?.pressed;
      // A new pad (or the first read) only learns what is held; it does not press anything.
      if (bestAt === active) {
        if (na && !a) pressed.add(PAD_A);
        if (nb && !b) pressed.add(PAD_B);
        if (ns && !start) pressed.add(PAD_START);
      } else {
        active = bestAt;
      }
      a = na;
      b = nb;
      start = ns;
      return out;
    },
  };
}
