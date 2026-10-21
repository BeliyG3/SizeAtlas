import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListItem } from "../../api/types";
import { I18nProvider } from "../../i18n/react";
import { ContentsRow } from "./ContentsRow";

vi.mock("../../settings/react", async () => {
  const { PALETTES } = await import("../../palette");
  return { useSize: () => String, usePalette: () => PALETTES.dark };
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
};

describe("ContentsRow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lets a name and a path keep their own direction in a right-to-left table", () => {
    vi.stubGlobal("navigator", { languages: ["ar"] });
    const none = () => {};
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
});
