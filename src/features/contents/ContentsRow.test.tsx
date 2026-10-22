import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Item, ListItem } from "../../api/types";
import { I18nProvider } from "../../i18n/react";
import { ContentsRow } from "./ContentsRow";

vi.mock("../../settings/react", async () => {
  const { PALETTES } = await import("../../palette");
  return {
    useSize: () => String,
    useSettings: () => ({ unit: "auto" }),
    usePalette: () => PALETTES.dark,
  };
});

const item: ListItem = {
  id: 1,
  name: "تقرير.txt",
  size: 10,
  len: 10,
  files: 0,
  dirs: 0,
  folders: 0,
  modified: 0,
  isDir: false,
  category: 0,
  accessError: false,
  cloud: false,
  lossy: false,
  folder: "docs/مجلد",
  parent: 0,
  deleted: false,
  before: null,
  change: null,
  approxChange: false,
};

const none = () => {};

/** Markup of the Change cell of `over` in English. */
function changeCell(over: Partial<Item>) {
  vi.stubGlobal("navigator", { languages: ["en"] });
  const html = renderToStaticMarkup(
    <I18nProvider>
      <ContentsRow
        index={0}
        item={{ ...item, ...over }}
        unaccounted={0}
        folderSize={10}
        detail={undefined}
        columns={["change"]}
        template=""
        width={0}
        selected={false}
        cursor={false}
        onClick={none}
        onOpen={none}
        onMenu={none}
      />
    </I18nProvider>,
  );
  return html.match(/<span role="gridcell" data-col="change".*?<\/span>/)?.[0];
}

const COVERAGE = "This folder was readable in only one of the two scans";

describe("ContentsRow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lets a name and a path keep their own direction in a right-to-left table", () => {
    vi.stubGlobal("navigator", { languages: ["ar"] });
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContentsRow
          index={0}
          item={item}
          unaccounted={0}
          folderSize={10}
          detail={undefined}
          columns={["name", "path"]}
          template=""
          width={0}
          folderPath="C:\data"
          selected={false}
          cursor={false}
          onClick={none}
          onOpen={none}
          onMenu={none}
        />
      </I18nProvider>,
    );
    expect(html).toContain('<span class="ellipsis" dir="auto">تقرير.txt</span>');
    expect(html).toMatch(/<span role="gridcell" data-col="path" dir="auto"[^>]*>docs\/مجلد</);
  });

  it("shows growth and shrinking with their sign and colour, nothing for no change", () => {
    expect(changeCell({ change: { delta: 1536 } })).toBe(
      '<span role="gridcell" data-col="change" class="num change-up">+1.50 KB</span>',
    );
    expect(changeCell({ change: { delta: -1536 } })).toBe(
      '<span role="gridcell" data-col="change" class="num change-down">−1.50 KB</span>',
    );
    expect(changeCell({ change: { delta: 0 } })).toBe(
      '<span role="gridcell" data-col="change" class="num"></span>',
    );
    expect(changeCell({ change: null })).toBe(
      '<span role="gridcell" data-col="change" class="num"></span>',
    );
  });

  it("marks new items, unknown and approximate changes", () => {
    expect(changeCell({ change: "new" })).toBe(
      '<span role="gridcell" data-col="change" class="num">new</span>',
    );
    expect(changeCell({ change: "unknown" })).toBe(
      `<span role="gridcell" data-col="change" class="num" title="${COVERAGE}">?</span>`,
    );
    expect(changeCell({ change: { delta: -1536 }, approxChange: true })).toBe(
      `<span role="gridcell" data-col="change" class="num change-down" title="${COVERAGE}">≈ −1.50 KB</span>`,
    );
  });
});
