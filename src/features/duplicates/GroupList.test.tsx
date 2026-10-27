import { beforeEach, describe, expect, it, vi } from "vitest";
import { rt } from "../lists/hookRuntime";
import { scrollToRow } from "../contents/useCursor";
import { DEFAULT_GROUP_SORT } from "./columns";
import { group } from "./dup.testSupport";
import { GroupList } from "./GroupList";
import { createThumbQueue } from "./thumbs";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../../settings/react", () => ({ useSize: () => String }));
vi.mock("../columns/useGridColumns", () => ({
  useGridColumns: () => ({
    ids: ["name", "copies", "size", "free"],
    columns: [],
    width: 400,
    template: "1fr",
  }),
}));
vi.mock("../contents/tableView", () => ({
  useViewport: () => ({ scrollTop: 0, viewport: 0, onScroll: () => {} }),
  tableKeyDown: () => {},
}));
vi.mock("../contents/useCursor", () => ({ scrollToRow: vi.fn() }));

const body = {};
const queue = createThumbQueue();

function render(keys: string[], selected: string, reveal: { key: string } | null) {
  rt.state.at = 0;
  GroupList({
    groups: keys.map((k) => group(k)),
    selected,
    reveal,
    onPick: () => {},
    sort: DEFAULT_GROUP_SORT,
    onSort: () => {},
    queue,
  });
  for (const run of rt.state.queue.splice(0)) run();
}

beforeEach(() => {
  vi.clearAllMocks();
  // The scrolling body is the first hook of the list.
  rt.state.slots = [{ value: { current: body } }];
});

describe("GroupList", () => {
  it("scrolls to a group stepped to elsewhere, never to one shown by default", () => {
    render(["a", "b", "c"], "a", null);
    // A bigger group landed on top while the user scrolled: the list stays where it is.
    render(["d", "a", "b", "c"], "d", null);
    expect(scrollToRow).not.toHaveBeenCalled();

    const step = { key: "c" };
    render(["d", "a", "b", "c"], "c", step);
    expect(scrollToRow).toHaveBeenCalledExactlyOnceWith(body, 3);
    // The same step, the result grown since: done already.
    render(["e", "d", "a", "b", "c"], "c", step);
    expect(scrollToRow).toHaveBeenCalledTimes(1);
  });
});
