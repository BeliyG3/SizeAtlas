import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { noMarks } from "../contents/marks";
import { copy, group } from "./dup.testSupport";
import { GroupDetail, type CopyPick } from "./GroupDetail";
import { createThumbQueue } from "./thumbs";

vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    lang: "en",
  }),
}));
vi.mock("../../settings/react", () => ({ useSize: () => (n: number) => `${n} B` }));
vi.mock("../../api/client", () => ({ api: { reveal: vi.fn() } }));

type Props = { role?: string; children?: ReactNode; className?: string };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}
const roles = (tree: ReactNode) => elements(tree).flatMap((e) => e.props.role ?? []);

const onPick = vi.fn();
const onTrash = vi.fn();
const onMenu = vi.fn();
const onFail = vi.fn();
const pick = (ids: number[] = [], cursor: number | null = null): CopyPick => ({
  marks: { ...noMarks("k"), ids: new Set(ids) },
  cursor,
});

function detail(at: CopyPick = pick(), copies = [copy(1), copy(2), copy(3)]) {
  const props = { onPick, onTrash, onMenu, onFail, queue: createThumbQueue() };
  return GroupDetail({ group: group("a", 10, { copies }), pick: at, ...props }) as ReactElement;
}

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
  vi.clearAllMocks();
  vi.mocked(api.reveal).mockResolvedValue();
});

describe("the copies of a group", () => {
  it("is a grid that the keys move through", () => {
    const tree = detail();
    expect(roles(tree)).toContain("grid");
    expect(roles(tree)).toContain("gridcell");
  });

  it("writes the count of copies with the number format of the language", () => {
    const copies = Array.from({ length: 1234 }, (_, i) => copy(i + 1, { path: `C:\\f${i}.jpg` }));
    const tree = detail(pick(), copies);
    expect(JSON.stringify(tree)).toContain('dup.copies {\\"count\\":1234,\\"copies\\":\\"1,234\\"');
  });

  it("keeps the title on one line that ends in an ellipsis", () => {
    expect(elements(detail()).find((e) => e.props.className === "dup-name")).toBeDefined();
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
});
