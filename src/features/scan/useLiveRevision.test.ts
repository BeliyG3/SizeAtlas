import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefreshGroup } from "./cadence";
import { useLiveRevision } from "./useLiveRevision";

const hooks = vi.hoisted(() => {
  type Effect = { deps: readonly unknown[]; cleanup?: () => void };
  const state = {
    values: [] as unknown[],
    refs: [] as { current: unknown }[],
    effects: [] as Effect[],
    queued: [] as (() => void)[],
    stateAt: 0,
    refAt: 0,
    effectAt: 0,
  };
  const beginRender = () => {
    state.stateAt = 0;
    state.refAt = 0;
    state.effectAt = 0;
  };
  const commit = () => state.queued.splice(0).forEach((run) => run());
  const unmount = () => {
    state.effects.forEach((effect) => effect.cleanup?.());
    state.values = [];
    state.refs = [];
    state.effects = [];
    state.queued = [];
  };
  return { state, beginRender, commit, unmount };
});

// Preserve hook state and commit effect cleanup with no renderer dependency.
vi.mock("react", () => ({
  useRef: (value: unknown) => {
    const index = hooks.state.refAt++;
    return (hooks.state.refs[index] ??= { current: value });
  },
  useState: (value: unknown) => {
    const index = hooks.state.stateAt++;
    if (!(index in hooks.state.values)) hooks.state.values[index] = value;
    return [
      hooks.state.values[index],
      (next: unknown) => {
        hooks.state.values[index] = next;
      },
    ];
  },
  useEffect: (callback: () => (() => void) | void, deps: readonly unknown[]) => {
    const index = hooks.state.effectAt++;
    const previous = hooks.state.effects[index];
    if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
    hooks.state.queued.push(() => {
      previous?.cleanup?.();
      hooks.state.effects[index] = { deps, cleanup: callback() ?? undefined };
    });
  },
}));

function useRenderRevision(rev: number, live = true, group: RefreshGroup = "tree") {
  hooks.beginRender();
  const shown = useLiveRevision(rev, live, group);
  hooks.commit();
  return shown;
}

beforeEach(() => {
  hooks.unmount();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  hooks.unmount();
  vi.useRealTimers();
});

describe("useLiveRevision", () => {
  it.each([
    ["tree", 2000],
    ["charts", 5000],
  ] as const)("applies live %s revisions only after the %i ms gate", (group, minimum) => {
    expect(useRenderRevision(1, true, group)).toBe(1);
    expect(useRenderRevision(2, true, group)).toBe(1);

    vi.advanceTimersByTime(minimum - 1);
    expect(useRenderRevision(2, true, group)).toBe(1);
    vi.advanceTimersByTime(1);
    expect(useRenderRevision(2, true, group)).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces to the latest revision without restarting the gate", () => {
    useRenderRevision(1);
    useRenderRevision(2);
    vi.advanceTimersByTime(1000);
    expect(useRenderRevision(3)).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(900);
    expect(useRenderRevision(4)).toBe(1);

    vi.advanceTimersByTime(100);
    expect(useRenderRevision(4)).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts the next gate from the previously applied revision", () => {
    useRenderRevision(1);
    useRenderRevision(2);
    vi.advanceTimersByTime(2000);
    expect(useRenderRevision(2)).toBe(2);
    vi.advanceTimersByTime(500);
    expect(useRenderRevision(3)).toBe(2);

    vi.advanceTimersByTime(1499);
    expect(useRenderRevision(3)).toBe(2);
    vi.advanceTimersByTime(1);
    expect(useRenderRevision(3)).toBe(3);
  });

  it("shows completion immediately and clears its pending live timer", () => {
    useRenderRevision(1);
    useRenderRevision(2);
    vi.advanceTimersByTime(100);

    expect(useRenderRevision(3, false)).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(useRenderRevision(4, false)).toBe(4);
  });

  it("clears the timer on unmount", () => {
    useRenderRevision(1);
    useRenderRevision(2);
    expect(vi.getTimerCount()).toBe(1);

    hooks.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(hooks.state.values).toEqual([]);
  });

  it("shows the current revision immediately when navigation remounts the viewer", () => {
    useRenderRevision(1, true, "charts");
    useRenderRevision(2, true, "charts");
    vi.advanceTimersByTime(1000);
    hooks.unmount();

    expect(useRenderRevision(9, true, "charts")).toBe(9);
    expect(vi.getTimerCount()).toBe(0);
    expect(useRenderRevision(10, true, "charts")).toBe(9);
    vi.advanceTimersByTime(4999);
    expect(useRenderRevision(10, true, "charts")).toBe(9);
    vi.advanceTimersByTime(1);
    expect(useRenderRevision(10, true, "charts")).toBe(10);
  });
});
