import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, onDuplicatesStatus } from "../../api/client";
import { rt } from "../lists/hookRuntime";
import type { DupScope } from "../../api/duplicates";
import type { Summary } from "../../api/types";
import { SplitPane } from "../shell/SplitPane";
import { DupHeader } from "./DupHeader";
import { answer, estimate, group, status } from "./dup.testSupport";
import { DuplicatesView, type DupMenuTrash } from "./DuplicatesView";
import { GroupDetail } from "./GroupDetail";
import { GroupList } from "./GroupList";
import { Lightbox } from "./viewer/Lightbox";
import { useViewerSync } from "./viewer/viewerWindow";

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
    openViewer: vi.fn(() => Promise.resolve()),
  },
  isCmdError: () => false,
  onDuplicatesStatus: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../../settings/react", () => ({
  useSize: () => String,
  useSettings: () => ({ resolved: "dark" }),
}));
vi.mock("./viewer/viewerWindow", () => ({ useViewerSync: vi.fn() }));

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
function render(committed: string, field: string, pending = false, folder: DupScope | null = null) {
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
      folder,
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
afterEach(() => vi.unstubAllGlobals());

describe("Find in the duplicates mode", () => {
  it("searches the text in the field right after typing, and commits it", () => {
    render("type:image", "  *.png   holiday ");
    header().props.onFind();
    expect(onCommit).toHaveBeenCalledWith("*.png holiday");
    expect(api.findDuplicates).toHaveBeenCalledWith("*.png holiday", false, null);
    expect(api.estimateDuplicates).toHaveBeenLastCalledWith("type:image", false, null);
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
    expect(api.findDuplicates).toHaveBeenCalledWith("type:image", false, null);
  });
});

describe("the folder searched", () => {
  const photos: DupScope = { root: "C:\\", generation: 1, folder: 7 };

  it("is the folder selected in the tree, or every open drive with the switch on", async () => {
    render("type:image", "type:image", false, photos);
    expect(api.estimateDuplicates).toHaveBeenLastCalledWith("type:image", false, photos);
    header().props.onFind();
    expect(api.findDuplicates).toHaveBeenLastCalledWith("type:image", false, photos);
    // The first Find is taken before the next one is sent.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(header().props.everywhere).toBe(false);
    expect(header().props.scoped).toBe(true);
    header().props.onEverywhere(true);
    render("type:image", "type:image", false, photos);
    expect(header().props.everywhere).toBe(true);
    expect(header().props.scoped).toBe(false);
    expect(api.estimateDuplicates).toHaveBeenLastCalledWith("type:image", false, null);
    header().props.onFind();
    expect(api.findDuplicates).toHaveBeenLastCalledWith("type:image", false, null);
  });

  it("is every open drive without a tree of the selected root", () => {
    render("type:image", "type:image", false, null);
    expect(header().props.everywhere).toBe(false);
    expect(header().props.scoped).toBe(false);
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

const list = () =>
  (element(SplitPane)!.props as { first: ReactElement<Parameters<typeof GroupList>[0]> }).first;

describe("the full-screen view", () => {
  it("opens for a picture, steps over the groups without one, and closes when it is gone", async () => {
    vi.stubGlobal("document", { activeElement: null });
    const groups = [group("a", 30), group("b", 20, { name: "b.txt" }), group("c", 10)];
    vi.mocked(api.getDuplicates).mockResolvedValue(answer({ job: 1, version: 2, groups }));
    render("type:image", "type:image");
    await settle();
    const lightbox = () => element(Lightbox);
    expect(lightbox()).toBeUndefined();
    detail().props.onFull();
    render("type:image", "type:image");
    expect(lightbox()!.props).toMatchObject({ position: 1, total: 2 });
    expect(lightbox()!.props.group.key).toBe("a");

    lightbox()!.props.onStep(1);
    render("type:image", "type:image");
    expect(detail().props.group.key).toBe("c");
    expect(lightbox()!.props).toMatchObject({ position: 2, total: 2 });
    expect(list().props.reveal).toEqual({ key: "c" });
    lightbox()!.props.onStep(1);
    render("type:image", "type:image");
    expect(detail().props.group.key).toBe("c");

    lightbox()!.props.onClose();
    render("type:image", "type:image");
    expect(lightbox()).toBeUndefined();

    // A group without a picture never opens it, and picking one closes it.
    detail().props.onFull();
    render("type:image", "type:image");
    list().props.onPick("b");
    render("type:image", "type:image");
    expect(lightbox()).toBeUndefined();
    detail().props.onFull();
    render("type:image", "type:image");
    expect(lightbox()).toBeUndefined();
    list().props.onPick("c");
    render("type:image", "type:image");
    expect(lightbox()).toBeUndefined();
  });

  it("closes when the groups are gone, and stays closed when they come back", async () => {
    vi.stubGlobal("document", { activeElement: null });
    vi.mocked(api.getDuplicates).mockResolvedValue(
      answer({ job: 1, version: 2, groups: [group("a")] }),
    );
    render("type:image", "type:image");
    await settle();
    detail().props.onFull();
    render("type:image", "type:image");
    expect(element(Lightbox)).toBeDefined();

    // A new search: its first answer has no group yet.
    const told = vi.mocked(onDuplicatesStatus).mock.lastCall![0];
    vi.mocked(api.getDuplicates).mockResolvedValue(answer({ job: 2, version: 1, groups: [] }));
    told(status({ job: 2, version: 1 }));
    await settle();
    expect(element(SplitPane)).toBeUndefined();
    expect(element(Lightbox)).toBeUndefined();

    vi.mocked(api.getDuplicates).mockResolvedValue(
      answer({ job: 2, version: 2, groups: [group("a")] }),
    );
    told(status({ job: 2, version: 2 }));
    await settle();
    expect(detail().props.group.key).toBe("a");
    expect(element(Lightbox)).toBeUndefined();
  });

  it("keeps the group it opened on when a bigger one comes in", async () => {
    vi.stubGlobal("document", { activeElement: null });
    vi.mocked(api.getDuplicates).mockResolvedValue(
      answer({ job: 1, version: 2, groups: [group("a", 30)] }),
    );
    render("type:image", "type:image");
    await settle();
    // Nothing picked: the first group is shown, and the full screen opens on it.
    detail().props.onFull();
    render("type:image", "type:image");
    expect(element(Lightbox)!.props.group.key).toBe("a");

    const told = vi.mocked(onDuplicatesStatus).mock.lastCall![0];
    vi.mocked(api.getDuplicates).mockResolvedValue(
      answer({ job: 1, version: 3, groups: [group("big", 99), group("a", 30)] }),
    );
    told(status({ job: 1, version: 3 }));
    await settle();
    expect(list().props.groups[0].key).toBe("big");
    expect(element(Lightbox)!.props.group.key).toBe("a");
  });
});

describe("the viewer window", () => {
  it("opens titled in the theme in effect, and follows the group shown", async () => {
    vi.mocked(api.getDuplicates).mockResolvedValue(
      answer({ job: 1, version: 2, groups: [group("a"), group("b")] }),
    );
    render("type:image", "type:image");
    await settle();
    expect(vi.mocked(useViewerSync).mock.lastCall![0]?.key).toBe("a");
    detail().props.onWindow();
    expect(api.openViewer).toHaveBeenCalledWith("dup.view.title", true);
    list().props.onPick("b");
    render("type:image", "type:image");
    expect(vi.mocked(useViewerSync).mock.lastCall![0]?.key).toBe("b");
  });
});
