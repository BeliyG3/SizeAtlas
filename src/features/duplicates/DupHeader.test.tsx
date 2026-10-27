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

type Props = Parameters<typeof DupHeader>[0];
const header = (more: Partial<Props>) =>
  DupHeader({
    estimate: estimate(),
    state: null,
    status: null,
    query: "type:image",
    system: false,
    onSystem,
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

  it("names the roots still being scanned", () => {
    const tree = header({ estimate: estimate({ skipped: ["W:\\", "D:\\"] }) });
    expect(text(tree)).toContain('dup.skipped {"roots":"W:\\\\, D:\\\\"}');
  });
});
