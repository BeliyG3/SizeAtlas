import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DupHeader } from "./DupHeader";
import { answer, estimate, group, status } from "./dup.testSupport";
import { applyAnswer } from "./groups";

vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    lang: "en",
  }),
}));
vi.mock("../../settings/react", () => ({ useSize: () => (n: number) => `${n} B` }));

const onFind = vi.fn();
const onCancel = vi.fn();
const onSystem = vi.fn();
const onEverywhere = vi.fn();

type Props = Parameters<typeof DupHeader>[0];
const header = (more: Partial<Props>) =>
  DupHeader({
    estimate: estimate(),
    state: null,
    status: null,
    query: "type:image",
    system: false,
    everywhere: false,
    scoped: true,
    onSystem,
    onEverywhere,
    onFind,
    onCancel,
    ...more,
  }) as ReactElement;

/** Every element of the tree, depth first. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element, ...elements(element.props.children)];
}
const text = (node: ReactNode): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : elements(node)
        .map((e) => (e.props as { children?: ReactNode }).children)
        .flat()
        .filter((c) => typeof c === "string" || typeof c === "number")
        .join(" ");
const buttons = (tree: ReactElement) =>
  elements(tree).filter((e) => e.type === "button") as ReactElement<{
    children: ReactNode;
    onClick: () => void;
  }>[];
const button = (tree: ReactElement, label: string) =>
  buttons(tree).find((b) => text(b).includes(label));

beforeEach(() => vi.clearAllMocks());

describe("the header of the duplicates", () => {
  it("offers Find and what it would compare before the first search", () => {
    const tree = header({ state: applyAnswer(null, answer()), status: status() });
    expect(text(tree)).toContain('dup.toCompare {"count":10,"files":"10","size":"40960 B"}');
    expect(button(tree, "dup.continue")).toBeUndefined();
    button(tree, "dup.find")!.props.onClick();
    expect(onFind).toHaveBeenCalledTimes(1);
  });

  it("keeps Find off while a Find is being sent", () => {
    const tree = header({ state: applyAnswer(null, answer()), status: status(), finding: true });
    expect((button(tree, "dup.find")!.props as { disabled?: boolean }).disabled).toBe(true);
    const idle = header({ state: applyAnswer(null, answer()), status: status() });
    expect((button(idle, "dup.find")!.props as { disabled?: boolean }).disabled).toBe(false);
  });

  it("shows the phase and Cancel while the search runs", () => {
    const running = status({
      job: 1,
      running: true,
      phase: "prefix",
      filesDone: 3,
      filesTotal: 12,
    });
    const tree = header({
      state: applyAnswer(null, answer({ job: 1, running: true })),
      status: running,
    });
    expect(text(tree)).toContain('dup.phasePrefix {"done":"3","total":"12"}');
    expect(button(tree, "dup.find")).toBeUndefined();
    button(tree, "dup.cancel")!.props.onClick();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("counts the bytes read while whole files are compared", () => {
    const running = status({
      job: 1,
      running: true,
      phase: "full",
      bytesDone: 100,
      bytesTotal: 400,
    });
    const tree = header({
      state: applyAnswer(null, answer({ job: 1, running: true })),
      status: running,
    });
    expect(text(tree)).toContain('dup.phaseFull {"done":"100 B","total":"400 B"}');
  });

  it("offers Continue after a search that did not finish", () => {
    const state = applyAnswer(null, answer({ job: 1, complete: false, groups: [group("a", 7)] }));
    const tree = header({ state, status: status({ job: 1 }) });
    expect(text(tree)).toContain("dup.unfinished");
    expect(text(tree)).toContain('dup.summary {"count":1,"groups":"1","size":"7 B"}');
    button(tree, "dup.continue")!.props.onClick();
    expect(onFind).toHaveBeenCalledTimes(1);
  });

  it("offers Find, not Continue, once the query is another", () => {
    const state = applyAnswer(null, answer({ job: 1, complete: false }));
    const tree = header({ state, status: status({ job: 1 }), query: "*.mp4" });
    expect(button(tree, "dup.continue")).toBeUndefined();
    expect(button(tree, "dup.find")).toBeDefined();
  });

  it("says when the result is out of date and what could not be read", () => {
    const state = applyAnswer(
      null,
      answer({ job: 1, complete: true, unread: { cloud: 2, changed: 0, noAccess: 1, failed: 0 } }),
    );
    const tree = header({ state, status: status({ job: 1, stale: true }) });
    expect(text(tree)).toContain("dup.stale");
    expect(text(tree)).toContain("dup.unread");
    expect(text(tree)).toContain('"count":3');
    expect(text(tree)).toContain("dup.reason.cloud");
    expect(text(tree)).not.toContain("dup.reason.changed");
    expect(text(tree)).not.toContain("dup.unfinished");
  });

  it("names the roots the shown result left out, once there is one", () => {
    const state = applyAnswer(null, answer({ job: 1, complete: true, skipped: ["D:\\"] }));
    const tree = header({ state, status: status({ job: 1 }), estimate: estimate() });
    expect(text(tree)).toContain('dup.skipped {"roots":"D:\\\\"}');
  });

  it("keeps one live region for the totals, always there and without the controls", () => {
    for (const tree of [
      header({ estimate: null }),
      header({
        state: applyAnswer(null, answer({ job: 1, running: true })),
        status: status({ job: 1, running: true }),
      }),
    ]) {
      const regions = elements(tree).filter(
        (e) => (e.props as { role?: string }).role === "status",
      );
      expect(regions).toHaveLength(1);
      const inside = elements((regions[0].props as { children?: ReactNode }).children);
      expect(inside.some((e) => e.type === "button" || e.type === "input")).toBe(false);
    }
  });

  it("writes the count of unread files with the number format of the language", () => {
    const state = applyAnswer(
      null,
      answer({
        job: 1,
        complete: true,
        unread: { cloud: 1234, changed: 0, noAccess: 0, failed: 0 },
      }),
    );
    const tree = header({ state, status: status({ job: 1 }) });
    expect(text(tree)).toContain('dup.unread {"count":1234,"files":"1,234"');
  });

  it("switches the search to every open drive, but not while one runs", () => {
    const boxes = (tree: ReactElement) =>
      elements(tree).filter((e) => e.type === "label" && text(e).includes("dup.everywhere"));
    const box = (tree: ReactElement) =>
      elements(boxes(tree)[0]).find((e) => e.type === "input") as ReactElement<{
        checked: boolean;
        disabled: boolean;
        onChange: (e: { currentTarget: { checked: boolean } }) => void;
      }>;
    const idle = header({ everywhere: true });
    expect(boxes(idle)).toHaveLength(1);
    expect(box(idle).props.checked).toBe(true);
    expect(box(idle).props.disabled).toBe(false);
    box(idle).props.onChange({ currentTarget: { checked: false } });
    expect(onEverywhere).toHaveBeenCalledWith(false);
    const running = header({
      state: applyAnswer(null, answer({ job: 1, running: true })),
      status: status({ job: 1, running: true }),
    });
    expect(box(running).props.disabled).toBe(true);
  });

  it("names the folder searched: of the estimate, then of the result", () => {
    expect(text(header({ estimate: estimate({ scope: "/photos" }) }))).toContain(
      'dup.scope {"path":"/photos"}',
    );
    expect(text(header({}))).not.toContain("dup.scope");
    const state = applyAnswer(null, answer({ job: 1, complete: true, scope: "/old" }));
    const tree = header({ state, status: status({ job: 1 }), estimate: estimate({ scope: null }) });
    expect(text(tree)).toContain('dup.scope {"path":"/old"}');
    // The result of every open drive names no folder.
    const all = applyAnswer(null, answer({ job: 1, complete: true }));
    expect(text(header({ state: all, estimate: estimate({ scope: "/" }) }))).not.toContain(
      "dup.scope",
    );
  });

  it("says where Find searches once that is not the folder of the result", () => {
    const state = applyAnswer(null, answer({ job: 1, complete: true, scope: "/old" }));
    const at = (scope: string | null, more: Partial<Props> = {}) =>
      text(header({ state, status: status({ job: 1 }), estimate: estimate({ scope }), ...more }));
    expect(at("/new")).toContain('dup.scope {"path":"/old"}');
    expect(at("/new")).toContain('dup.next {"path":"/new"}');
    expect(at("/old")).not.toContain("dup.next");
    // A root being rescanned: the estimate names no folder, the skipped line names the root.
    expect(at(null)).not.toContain("dup.next");
    const all = applyAnswer(null, answer({ job: 1, complete: true }));
    expect(text(header({ state: all, estimate: estimate({ scope: "/" }) }))).toContain(
      'dup.next {"path":"/"}',
    );
  });

  it("says Find searches every open drive once the switch is on after a folder result", () => {
    const folder = applyAnswer(null, answer({ job: 1, complete: true, scope: "/old" }));
    const on = { everywhere: true, scoped: false, estimate: estimate({ scope: null }) };
    expect(text(header({ state: folder, ...on }))).toContain("dup.findWhere");
    const all = applyAnswer(null, answer({ job: 1, complete: true }));
    expect(text(header({ state: all, ...on }))).not.toContain("dup.findWhere");
    expect(text(header(on))).not.toContain("dup.findWhere");
  });

  it("says Find searches every open drive when no folder can be sent", () => {
    const none = { scoped: false, estimate: estimate({ scope: null }) };
    expect(text(header(none))).toContain("dup.findWhere");
    // With the switch off, even after a search of every open drive.
    const all = applyAnswer(null, answer({ job: 1, complete: true }));
    expect(text(header({ state: all, ...none }))).toContain("dup.findWhere");
    const running = applyAnswer(null, answer({ job: 1, running: true, scope: "/old" }));
    const tree = header({ state: running, status: status({ job: 1, running: true }), ...none });
    expect(text(tree)).not.toContain("dup.findWhere");
  });

  it("offers Continue only for the same folder", () => {
    const state = applyAnswer(null, answer({ job: 1, complete: false, scope: "/a" }));
    const same = header({ state, status: status({ job: 1 }), estimate: estimate({ scope: "/a" }) });
    expect(button(same, "dup.continue")).toBeDefined();
    for (const scope of ["/b", null]) {
      const other = header({ state, status: status({ job: 1 }), estimate: estimate({ scope }) });
      expect(button(other, "dup.continue")).toBeUndefined();
      expect(button(other, "dup.find")).toBeDefined();
    }
  });

  it("names the roots still being scanned", () => {
    const tree = header({ estimate: estimate({ skipped: ["W:\\", "D:\\"] }) });
    expect(text(tree)).toContain('dup.skipped {"roots":"W:\\\\, D:\\\\"}');
  });
});
