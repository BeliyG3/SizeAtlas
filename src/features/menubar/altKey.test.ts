import { describe, expect, it } from "vitest";
import { loneAlt, type AltKeyEvent } from "./altKey";

const key = (name: string, held: Partial<AltKeyEvent> = {}): AltKeyEvent => ({
  key: name,
  repeat: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...held,
});

/** Feeds the events (none of them the release of Alt) and returns the final state. */
const after = (events: AltKeyEvent[]) => events.reduce(loneAlt, false);

describe("lone Alt", () => {
  it("counts Alt pressed alone, also while it repeats", () => {
    expect(after([key("Alt")])).toBe(true);
    expect(after([key("Alt"), key("Alt", { repeat: true })])).toBe(true);
  });

  it("does not count Alt pressed with Shift, Ctrl or Meta held (layout switch)", () => {
    expect(after([key("Shift", { shiftKey: true }), key("Alt", { shiftKey: true })])).toBe(false);
    expect(after([key("Alt", { ctrlKey: true })])).toBe(false);
    expect(after([key("Alt", { metaKey: true })])).toBe(false);
  });

  it("forgets Alt once another key is pressed or released", () => {
    expect(after([key("Alt"), key("Shift", { shiftKey: true })])).toBe(false);
    // A key released while Alt is held (Shift let go after Shift+Alt).
    expect(after([key("Alt"), key("Shift")])).toBe(false);
    expect(after([key("Alt"), key("f")])).toBe(false);
  });
});
