import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Sources } from "../../api/types";
import { translate } from "../../i18n";
import { I18nProvider } from "../../i18n/react";
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
    <I18nProvider>
      <SourceItems
        sources={s}
        pending={pending}
        t={(key, params) => translate("en", key, params)}
        onPick={() => {}}
        onChooseFolder={() => {}}
      />
    </I18nProvider>,
  );

/** Every needle is in `html`, each after the one before it (a missing one fails). */
const expectInOrder = (html: string, ...needles: string[]) => {
  const at = needles.map((needle) => html.indexOf(needle));
  needles.forEach((needle, i) => {
    expect(at[i], `${needle} is missing`).toBeGreaterThanOrEqual(0);
    if (i > 0) expect(at[i], `${needle} after ${needles[i - 1]}`).toBeGreaterThan(at[i - 1]);
  });
};

describe("SourceItems", () => {
  it("lists drives, recent folders without the drives, then Choose folder", () => {
    const html = render("C:\\");
    expectInOrder(
      html,
      ">Drives<",
      "C:\\  System",
      "Z:\\ (Disconnected)",
      ">Recent folders<",
      "D:\\Work",
      'role="separator"',
      "Choose folder…",
    );
    expect(html).toContain("D:\\Old (saved by another version)");
    // C:\ is a drive: it is not repeated among the recent folders.
    expect(html.split(">C:\\").length - 1).toBe(1);
  });

  it("marks only the current source and dims a disconnected drive", () => {
    const html = render("D:\\Work");
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"(?:(?!<\/button>).)*D:\\Work/);
    expect(html).toMatch(/class="iconic dim"(?:(?!<\/button>).)*Z:\\/);
  });

  it("shows a source that is in neither list first", () => {
    const html = render("E:\\Other");
    expectInOrder(html, "E:\\Other", ">Drives<");
  });

  it("has no recent heading without recent folders", () => {
    expect(render(null, { disks: sources.disks, scans: [] })).not.toContain("Recent folders");
  });

  it("keeps the direction of every path label and shows it in full on hover", () => {
    const html = render("/Users/me/Downloads", {
      disks: [disk("Z:\\", "", false)],
      scans: [scan("/Users/me/Work")],
    });
    // The pending path, the drive and the recent folder: each label is its own path span.
    expect(html.match(/<span class="path" dir="auto" title="[^"]+">/g)).toHaveLength(3);
    expect(html).toContain(
      '<span class="path" dir="auto" title="/Users/me/Downloads">/Users/me/Downloads</span>',
    );
    expect(html).toContain('title="Z:\\ (Disconnected)"');
  });

  it("marks the group headings as presentation inside the menu", () => {
    const html = render("C:\\");
    expect(html.match(/<div class="heading" role="presentation">/g)).toHaveLength(2);
  });
});
