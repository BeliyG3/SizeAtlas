import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { rt } from "../lists/hookRuntime";
import { DupHeader } from "./DupHeader";
import { answer, estimate } from "./dup.testSupport";
import { DuplicatesView } from "./DuplicatesView";

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
  },
  onDuplicatesStatus: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));

const onCommit = vi.fn();
const onFail = vi.fn();
let shown: ReactElement;

/** `committed`: what the table got (it lags behind the field); `field`: the text in the field. */
function render(committed: string, field: string) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = DuplicatesView({
      query: committed,
      field,
      onCommit,
      rootsKey: "C:\\",
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

  it("never searches every type from a value that has not caught up with the field", () => {
    render("", "type:image");
    expect(header().props.query).toBe("type:image");
    header().props.onFind();
    expect(api.findDuplicates).toHaveBeenCalledWith("type:image", false);
  });
});
