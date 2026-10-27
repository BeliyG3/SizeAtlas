import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { noMarks } from "../contents/marks";
import { rt } from "../lists/hookRuntime";
import { SplitPane } from "../shell/SplitPane";
import { copy, group } from "./dup.testSupport";
import { GroupDetail, type CopyPick } from "./GroupDetail";
import { GroupTitle } from "./GroupPreview";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    lang: "en",
  }),
}));
vi.mock("../../api/client", () => ({ api: { reveal: vi.fn() } }));

type Props = { role?: string; children?: ReactNode; first?: ReactNode; second?: ReactNode };
/** The elements of a tree, the panes of a split among them. */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  const { children, first, second } = element.props;
  return [element, ...elements(children), ...elements(first), ...elements(second)];
}
const roles = (tree: ReactNode) => elements(tree).flatMap((e) => e.props.role ?? []);

const onPick = vi.fn();
const onTrash = vi.fn();
const onMenu = vi.fn();
const onFail = vi.fn();
const onFull = vi.fn();
const onWindow = vi.fn();
const pick = (ids: number[] = [], cursor: number | null = null): CopyPick => ({
  marks: { ...noMarks("k"), ids: new Set(ids) },
  cursor,
});

function detail(at: CopyPick = pick(), copies = [copy(1), copy(2), copy(3)], name = "a.jpg") {
  const props = { onPick, onTrash, onMenu, onFail, onFull, onWindow };
  const g = group("a", 10, { copies, name });
  rt.state.at = 0;
  return GroupDetail({ group: g, pick: at, picture: { state: "none" }, ...props }) as ReactElement;
}
const find = (tree: ReactElement, type: unknown) => elements(tree).find((e) => e.type === type)!;

/** Presses `key` on the copies table. */
function press(tree: ReactElement, key: string, more: Partial<KeyboardEvent> = {}) {
  const grid = elements(tree).find((e) => e.props.role === "grid")!;
  const el = { clientHeight: 300, scrollTop: 0, querySelector: () => null };
  const event = {
    key,
    code: "",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    target: el,
    currentTarget: el,
    preventDefault: vi.fn(),
    ...more,
  };
  (grid.props as { onKeyDown: (e: unknown) => void }).onKeyDown(event);
}

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.mocked(api.reveal).mockResolvedValue();
});

describe("the copies of a group", () => {
  it("is a grid that the keys move through", () => {
    const tree = detail();
    expect(roles(tree)).toContain("grid");
    expect(roles(tree)).toContain("gridcell");
  });

  it("opens the copy under the cursor from the title, else the first in table order", () => {
    const copies = [copy(1, { path: "C:\\b.jpg" }), copy(2, { path: "C:\\a.jpg" }), copy(3)];
    const target = (tree: ReactElement) =>
      (find(tree, GroupTitle).props as { target?: unknown }).target;
    expect(target(detail(pick([], 2), copies))).toBe(copies[2]);
    // By path, A to Z: a.jpg (copy 2) comes first.
    expect(target(detail(pick(), copies))).toBe(copies[1]);
  });

  it("hides the picture of a name of no image type, in the same split", () => {
    const collapse = (tree: ReactElement) =>
      (find(tree, SplitPane).props as { collapse?: string }).collapse;
    expect(collapse(detail())).toBeUndefined();
    expect(collapse(detail(pick(), undefined, "a.txt"))).toBe("first");
  });

  it("moves the cursor with the arrows and marks a range with Shift", () => {
    press(detail(pick([0], 0)), "ArrowDown");
    expect(onPick).toHaveBeenLastCalledWith({ marks: expect.anything(), cursor: 1 });
    expect([...onPick.mock.lastCall![0].marks.ids]).toEqual([1]);
    press(detail(pick([0], 0)), "ArrowDown", { shiftKey: true });
    expect([...onPick.mock.lastCall![0].marks.ids]).toEqual([0, 1]);
  });

  it("sends the marked copies, else the cursor one, to the trash on Delete; never on Shift+Delete", () => {
    press(detail(pick([0, 2], 2)), "Delete");
    expect(onTrash).toHaveBeenLastCalledWith([0, 2]);
    press(detail(pick([], 1)), "Delete");
    expect(onTrash).toHaveBeenLastCalledWith([1]);
    onTrash.mockClear();
    press(detail(pick([0], 0)), "Delete", { shiftKey: true });
    expect(onTrash).not.toHaveBeenCalled();
  });

  it("shows the copy in the file manager on Enter", () => {
    press(detail(pick([], 1)), "Enter");
    expect(api.reveal).toHaveBeenCalledWith(1, 2);
  });

  it("keeps the marks and the keys on the same copies in another order", () => {
    const copies = [
      copy(1, { path: "C:\\a.jpg", mtime: 100 }),
      copy(2, { path: "C:\\b.jpg", mtime: 300 }),
      copy(3, { path: "C:\\c.jpg", mtime: 200 }),
    ];
    const header = elements(detail(pick(), copies)).find(
      (e) => (e.props as { onSort?: unknown }).onSort,
    )!;
    // Newest first: b, c, a.
    (header.props as unknown as { onSort: (c: { id: string }) => void }).onSort({ id: "modified" });
    expect(onPick).toHaveBeenLastCalledWith({ marks: expect.anything(), cursor: null });
    const paths = (tree: ReactElement) =>
      elements(tree)
        .filter((e) => (e.props as { "data-col"?: string })["data-col"] === "path")
        .map((e) => e.props.children);
    expect(paths(detail(pick(), copies))).toEqual(["C:\\b.jpg", "C:\\c.jpg", "C:\\a.jpg"]);
    // The cursor on c (index 2), the second row: down is a, Shift+down marks c and a.
    press(detail(pick([], 2), copies), "ArrowDown");
    expect(onPick).toHaveBeenLastCalledWith({ marks: expect.anything(), cursor: 0 });
    press(detail(pick([], 2), copies), "ArrowDown", { shiftKey: true });
    expect([...onPick.mock.lastCall![0].marks.ids].sort()).toEqual([0, 2]);
    press(detail(pick([], 1), copies), "Enter");
    expect(api.reveal).toHaveBeenLastCalledWith(1, 2);
  });
});
