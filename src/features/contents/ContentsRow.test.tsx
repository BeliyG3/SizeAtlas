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
  reason: null,
  before: null,
  change: null,
  approxChange: false,
};

const none = () => {};

/** Markup of the Change cell of `over` in `lang`. */
function changeCell(over: Partial<Item>, lang = "en") {
  vi.stubGlobal("navigator", { languages: [lang] });
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
const APPROX = "The change is approximate";

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
      '<span role="gridcell" data-col="change" class="num change-up"><bdi dir="ltr">+1.50</bdi> KB</span>',
    );
    expect(changeCell({ change: { delta: -1536 } })).toBe(
      '<span role="gridcell" data-col="change" class="num change-down"><bdi dir="ltr">−1.50</bdi> KB</span>',
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
      `<span role="gridcell" data-col="change" class="num change-down" title="${APPROX}"><bdi dir="ltr">≈ −1.50</bdi> KB</span>`,
    );
  });

  it("keeps the sign and the approximate mark with the number in a right-to-left table", () => {
    expect(changeCell({ change: { delta: 1536 }, approxChange: true }, "ar")).toMatch(
      /class="num change-up" title="[^"]+"><bdi dir="ltr">≈ \+1\.50<\/bdi> كيلوبايت<\/span>$/,
    );
  });

  describe("the Why column", () => {
    const reasonCell = (reason: ListItem["reason"]) => {
      const html = renderToStaticMarkup(
        <I18nProvider>
          <ContentsRow
            index={0}
            item={{ ...item, reason }}
            unaccounted={0}
            folderSize={10}
            detail={undefined}
            columns={["reason"]}
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
      return html.match(/<span role="gridcell" data-col="reason"[\s\S]*<\/span>/)?.[0];
    };

    it("says why the row is offered, the same words in the tooltip", () => {
      const cell = reasonCell({ reason: "browserCache", command: null, restorable: null });
      expect(cell).toContain("Browser cache — the browser makes it again");
      expect(cell).toContain('title="Browser cache — the browser makes it again"');
      expect(cell).not.toContain("<code");
    });

    it("adds the lock file note for dependencies", () => {
      const cell = reasonCell({ reason: "nodeModules", command: null, restorable: true });
      expect(cell).toContain("Can be restored: a lock file is next to it");
    });

    it("shows the clean-up command of a tool, left to right, saying it deletes at once", () => {
      const cell = reasonCell({
        reason: "packageCache",
        command: "npm cache clean --force",
        restorable: null,
      });
      expect(cell).toContain(
        '<code dir="ltr" title="Deletes at once, without the Recycle Bin">npm cache clean --force</code>',
      );
    });

    it("is empty for a row of another list", () => {
      expect(reasonCell(null)).toBe('<span role="gridcell" data-col="reason"></span>');
    });
  });

  it("dims a deleted folder and says it is deleted after its name", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ContentsRow
          index={0}
          item={{ ...item, name: "gone", isDir: true, deleted: true }}
          unaccounted={0}
          folderSize={10}
          detail={undefined}
          columns={["name"]}
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
    expect(html).toMatch(/class="crow deleted"/);
    expect(html).toMatch(/>gone<\/span><span class="tag">deleted<\/span>/);
  });
});
