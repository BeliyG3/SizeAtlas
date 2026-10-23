import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

const hooks = vi.hoisted(() => ({
  value: undefined as unknown,
  has: false,
  cleanups: [] as (() => void)[],
}));

// One hook instance: the state survives renders, effects run at once, cleanups on demand.
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    if (!hooks.has) {
      hooks.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      hooks.has = true;
    }
    return [
      hooks.value,
      (next: unknown) => {
        hooks.value = next;
      },
    ];
  },
  useEffect: (effect: () => (() => void) | void) => {
    const cleanup = effect();
    if (cleanup) hooks.cleanups.push(cleanup);
  },
}));

const MINUTE = 60_000;

describe("useNow", () => {
  let focus: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    hooks.has = false;
    hooks.cleanups = [];
    focus = new EventTarget();
    vi.stubGlobal("window", focus);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts at the time of the first render and moves on every period", () => {
    expect(useNow(5 * MINUTE)).toBe(1_000_000);
    vi.advanceTimersByTime(5 * MINUTE);
    expect(useNow(5 * MINUTE)).toBe(1_000_000 + 5 * MINUTE);
    vi.advanceTimersByTime(5 * MINUTE);
    expect(useNow(5 * MINUTE)).toBe(1_000_000 + 10 * MINUTE);
  });

  it("does not move between periods", () => {
    useNow(5 * MINUTE);
    vi.advanceTimersByTime(5 * MINUTE - 1);
    expect(useNow(5 * MINUTE)).toBe(1_000_000);
  });

  it("catches up when the window gets the focus again (a sleeping laptop)", () => {
    useNow(5 * MINUTE);
    vi.setSystemTime(1_000_000 + 9 * 60 * MINUTE);
    focus.dispatchEvent(new Event("focus"));
    expect(useNow(5 * MINUTE)).toBe(1_000_000 + 9 * 60 * MINUTE);
  });

  it("stops its timer and listener when it goes away", () => {
    useNow(5 * MINUTE);
    hooks.cleanups.forEach((cleanup) => cleanup());
    vi.advanceTimersByTime(10 * MINUTE);
    focus.dispatchEvent(new Event("focus"));
    expect(useNow(5 * MINUTE)).toBe(1_000_000);
  });
});
