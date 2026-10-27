import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { rt } from "../lists/hookRuntime";
import type { Summary } from "../../api/types";
import { SplitPane } from "../shell/SplitPane";
import { DupHeader } from "./DupHeader";
import { answer, estimate, group } from "./dup.testSupport";
import { DuplicatesView, type DupMenuTrash } from "./DuplicatesView";
import { GroupDetail } from "./GroupDetail";
import { GroupList } from "./GroupList";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../api/client", () => ({
  api: {
    getDuplicates: vi.fn(),
    estimateDuplicates: vi.fn(),
    findDuplicates: vi.fn(),
    cancelDuplicates: vi.fn(),
    trashPreview: vi.fn(),
  },
  isCmdError: () => false,
  onDuplicatesStatus: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../../settings/react", () => ({ useSize: () => String }));

const onCommit = vi.fn();
const onFail = vi.fn();
const push = vi.fn();
const onMenuTrash = vi.fn<(menu: DupMenuTrash) => void>();
const entries = [
  { root: "C:\\", summary: { generation: 1, rev: 4 } as Summary, status: "open" as const },
];
const lastMenu = () => onMenuTrash.mock.lastCall![0];
let shown: ReactElement;

/** `committed`: what the table got (it lags behind the field); `field`: the text in the field. */
function render(committed: string, field: string, pending = false) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = DuplicatesView({
      query: committed,
      field,
      onCommit,
      runs: { start: vi.fn(), end: vi.fn(), pending },
      push,
      errorText: String,
      onTrashed: vi.fn(),
      onMenuTrash,
      entries,
      isRemoving: () => false,
      onFail,
    }) as ReactElement;
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the view never settled");
}

const header = () =>
  [(shown.props as { children: ReactNode }).children]
    .flat()
    .find((e): e is ReactElement<Parameters<typeof DupHeader>[0]> => {
      return typeof e === "object" && e !== null && "type" in e && e.type === DupHeader;
    })!;

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.mocked(api.getDuplicates).mockResolvedValue(answer());
  vi.mocked(api.estimateDuplicates).mockResolvedValue(estimate());
  vi.mocked(api.findDuplicates).mockResolvedValue(1);
});

describe("Find in the duplicates mode", () => {
  it("searches the text in the field right after typing, and commits it", () => {
    render("type:image", "  *.png   holiday ");
    header().props.onFind();
    expect(onCommit).toHaveBeenCalledWith("*.png holiday");
    expect(api.findDuplicates).toHaveBeenCalledWith("*.png holiday", false);
    expect(api.estimateDuplicates).toHaveBeenLastCalledWith("type:image", false);
  });

  it("waits while a removal of copies runs, even one sent before the mode was entered", () => {
    render("type:image", "type:image");
    expect(header().props.finding).toBe(false);
    render("type:image", "type:image", true);
    expect(header().props.finding).toBe(true);
  });

  it("never searches every type from a value that has not caught up with the field", () => {
    render("", "type:image");
    expect(header().props.query).toBe("type:image");
    header().props.onFind();
    expect(api.findDuplicates).toHaveBeenCalledWith("type:image", false);
  });
});

const element = <P,>(type: (props: P) => ReactNode) =>
  [(shown.props as { children: ReactNode }).children].flat().find((e): e is ReactElement<P> => {
    return typeof e === "object" && e !== null && "type" in e && e.type === type;
  });
const detail = () =>
  (element(SplitPane)!.props as { second: ReactElement<Parameters<typeof GroupDetail>[0]> }).second;
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  render("type:image", "type:image");
};
const marked = (ids: number[]) => ({
  ...detail().props.pick,
  marks: { ...detail().props.pick.marks, ids: new Set(ids) },
  cursor: ids[0],
});

describe("the trash of copies", () => {
  it("lets Delete outside the tables take the picked copies, and only those", async () => {
    vi.mocked(api.getDuplicates).mockResolvedValue(
      answer({ job: 1, version: 2, groups: [group("a")] }),
    );
    vi.mocked(api.trashPreview).mockReturnValue(new Promise(() => {}));
    render("type:image", "type:image");
    await settle();
    expect(lastMenu().run).toBeNull();
    detail().props.onPick(marked([1]));
    render("type:image", "type:image");
    lastMenu().run!();
    expect(api.trashPreview).toHaveBeenCalledWith(1, 4, [2]);
  });

  it("offers nothing while a search runs, and says why", async () => {
    vi.mocked(api.getDuplicates).mockResolvedValue(
      answer({ job: 1, version: 2, running: true, groups: [group("a")] }),
    );
    render("type:image", "type:image");
    await settle();
    detail().props.onPick(marked([1]));
    render("type:image", "type:image");
    expect(lastMenu()).toEqual({ run: null, note: "dup.searching" });
    detail().props.onTrash([1]);
    expect(push).toHaveBeenCalledWith("dup.searching");
    expect(api.trashPreview).not.toHaveBeenCalled();
  });

  it("never takes every copy of a group", async () => {
    vi.mocked(api.getDuplicates).mockResolvedValue(
      answer({ job: 1, version: 2, groups: [group("a")] }),
    );
    render("type:image", "type:image");
    await settle();
    detail().props.onTrash([0, 1]);
    expect(push).toHaveBeenCalledWith("dup.lastCopy");
    expect(api.trashPreview).not.toHaveBeenCalled();
  });
});

describe("the order of the groups", () => {
  it("keeps the group shown first, and its marks, when the groups are sorted again", async () => {
    vi.mocked(api.getDuplicates).mockResolvedValue(
      answer({ job: 1, version: 2, groups: [group("big", 99), group("small", 10)] }),
    );
    render("type:image", "type:image");
    await settle();
    expect(detail().props.group.key).toBe("big");
    detail().props.onPick(marked([1]));
    render("type:image", "type:image");
    const list = (
      element(SplitPane)!.props as { first: ReactElement<Parameters<typeof GroupList>[0]> }
    ).first;
    // Smallest saving first: "small" leads the list, the group shown stays.
    list.props.onSort({ column: "free", descending: false });
    render("type:image", "type:image");
    const first = (
      element(SplitPane)!.props as { first: ReactElement<Parameters<typeof GroupList>[0]> }
    ).first;
    expect(first.props.groups.map((g) => g.key)).toEqual(["small", "big"]);
    expect(detail().props.group.key).toBe("big");
    expect([...detail().props.pick.marks.ids]).toEqual([1]);
  });
});
