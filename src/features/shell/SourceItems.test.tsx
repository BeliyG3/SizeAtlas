import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Sources } from "../../api/types";
import { translate } from "../../i18n";
import { SourceItems } from "./SourceItems";

const disk = (mount: string, name: string, connected = true) =>
  ({ mount, name, connected }) as Sources["disks"][number];
const scan = (root: string, outdated = false) => ({ root, outdated }) as Sources["scans"][number];

const sources: Sources = {
  disks: [disk("C:\\", "System"), disk("Z:\\", "", false)],
  scans: [scan("C:\\"), scan("D:\\Work"), scan("D:\\Old", true)],
};

const render = (pending: string | null, s: Sources | null = sources) =>
  renderToStaticMarkup(
    <SourceItems
      sources={s}
      pending={pending}
      t={(key, params) => translate("en", key, params)}
      onPick={() => {}}
      onChooseFolder={() => {}}
    />,
  );

describe("SourceItems", () => {
  it("lists drives, recent folders without the drives, then Choose folder", () => {
    const html = render("C:\\");
    const at = (s: string) => html.indexOf(s);
    expect(at(">Drives<")).toBeLessThan(at("C:\\  System"));
    expect(at("Z:\\ (Disconnected)")).toBeLessThan(at(">Recent folders<"));
    expect(at(">Recent folders<")).toBeLessThan(at("D:\\Work"));
    expect(at("D:\\Work")).toBeLessThan(at('role="separator"'));
    expect(at('role="separator"')).toBeLessThan(at("Choose folder…"));
    expect(html).toContain("D:\\Old (saved by another version)");
    // C:\ is a drive: it is not repeated among the recent folders.
    expect(html.split("C:\\").length - 1).toBe(1);
  });

  it("marks only the current source and dims a disconnected drive", () => {
    const html = render("D:\\Work");
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"(?:(?!<\/button>).)*D:\\Work/);
    expect(html).toMatch(/class="iconic dim"(?:(?!<\/button>).)*Z:\\/);
  });

  it("shows a source that is in neither list first", () => {
    const html = render("E:\\Other");
    expect(html.indexOf("E:\\Other")).toBeLessThan(html.indexOf(">Drives<"));
  });

  it("has no recent heading without recent folders", () => {
    expect(render(null, { disks: sources.disks, scans: [] })).not.toContain("Recent folders");
  });
});
