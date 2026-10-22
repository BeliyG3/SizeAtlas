import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Summary } from "../../api/types";
import type { Mode } from "../lists/modes";
import { Viewer } from "./Viewer";

// A minimal hook runtime: state, memos and effects survive explicit renders, without a DOM.
const rt = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: unknown };
  const state = { slots: [] as Slot[], at: 0, dirty: false, queue: [] as (() => void)[] };
  const changed = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
  const slot = (): Slot => (state.slots[state.at++] ??= {});
  const memo = (make: () => unknown, deps?: readonly unknown[]) => {
    const s = slot();
    if (changed(s.deps, deps)) {
      s.value = make();
      s.deps = deps;
    }
    return s.value;
  };
  const effect = (run: () => unknown, deps?: readonly unknown[]) => {
    const s = slot();
    if (!changed(s.deps, deps)) return;
    s.deps = deps;
    state.queue.push(() => {
      if (typeof s.cleanup === "function") (s.cleanup as () => void)();
      s.cleanup = run();
    });
  };
  return {
    state,
    hooks: {
      useState: (initial: unknown) => {
        const s = slot();
        if (!("value" in s)) s.value = typeof initial === "function" ? initial() : initial;
        return [
          s.value,
          (next: unknown) => {
            const value = typeof next === "function" ? next(s.value) : next;
            if (!Object.is(value, s.value)) {
              s.value = value;
              state.dirty = true;
            }
          },
        ];
      },
      useMemo: memo,
      useCallback: (callback: unknown, deps?: readonly unknown[]) => memo(() => callback, deps),
      useEffect: effect,
    },
  };
});
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...rt.hooks,
}));
vi.mock("../../api/client", () => ({ api: { getLiveAncestor: vi.fn() } }));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../../settings/react", () => ({ useSettings: () => ({ showChart: true }) }));
vi.mock("../charts/ChartArea", () => ({ ChartArea: () => null }));
vi.mock("../contents/ContentsTable", () => ({ ContentsTable: () => null }));
vi.mock("../contents/useDetails", () => ({
  useDetails: () => ({ details: new Map(), request: () => {} }),
}));
vi.mock("../lists/ListTable", () => ({ ListTable: () => null }));
vi.mock("../shell/SplitPane", () => ({ SplitPane: () => null }));
vi.mock("../scan/useLiveRevision", () => ({ useLiveRevision: () => 0 }));
vi.mock("./useCrumbs", () => ({ useCrumbs: () => [] }));

const summary = { generation: 1, rev: 0, scanning: false } as Summary;
// Stable, as the parent's is: a new selection object would be a new choice.
const selection = { id: 1, folder: 1 };
const none = () => {};
const onLeaveSearch = vi.fn();
const onSelect = vi.fn();

/** The table the viewer shows, after the state has settled. */
function render(mode: Mode, query: string): ReactElement<Record<string, unknown>> {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    const split = (Viewer as unknown as { type: (props: object) => ReactElement }).type({
      summary,
      selection,
      mode,
      query,
      onLeaveSearch,
      sort: { column: "size", descending: true },
      onSort: none,
      onSelect,
      onMenu: none,
      onTrash: none,
      onMarks: none,
      onFail: none,
    });
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return (split.props as { first: ReactElement }).first as never;
  }
  throw new Error("the viewer never settled");
}

beforeEach(() => {
  vi.stubGlobal("window", { innerHeight: 800 });
  rt.state.slots = [];
  onLeaveSearch.mockReset();
  onSelect.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("Viewer leaving a search", () => {
  it("ends the search, then shows the folder, when a folder of the results is opened", () => {
    const table = render("all", "backup");
    expect(table.props.kind).toBe("search");
    const open = table.props.onOpenFolder as (id: number, parent?: number) => void;
    open(7, 3);
    expect(onLeaveSearch).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1, 7, true, 3);
    // The list is made for that folder, as for any other list.
    expect(render("all", "backup").props.base).toBe(7);
  });

  it("does not leave anything for the other lists", () => {
    const table = render("largest", "");
    expect(table.props.kind).toBe("largest");
    expect(table.props.onOpenFolder).toBeUndefined();
  });

  it("keeps Backspace and Up in the search: they only move its folder", () => {
    const table = render("all", "backup");
    (table.props.onEnter as (id: number) => void)(3);
    expect(onLeaveSearch).not.toHaveBeenCalled();
  });
});
