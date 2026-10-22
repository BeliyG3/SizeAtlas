import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Summary } from "../../api/types";
import { I18nProvider } from "../../i18n/react";
import { StatusBar } from "./StatusBar";

vi.mock("../../settings/react", () => ({ useSize: () => String }));

const DAY = 24 * 60 * 60;

const summary = (baselineAt: number | null): Summary => ({
  root: "/root",
  rootId: 0,
  generation: 1,
  rev: 1,
  total: 10,
  files: 1,
  len: 10,
  dirs: 1,
  accessErrors: 0,
  approximate: false,
  scannedAt: Date.now() / 1000 - 2 * DAY,
  sizeMode: "Allocated",
  volume: null,
  baselineAt,
  baselineRev: 0,
});

const render = (s: Summary) =>
  renderToStaticMarkup(
    <I18nProvider>
      <StatusBar summary={s} scan={null} trash={null} />
    </I18nProvider>,
  );

describe("StatusBar", () => {
  it("says when the root was scanned", () => {
    const html = render(summary(null));
    expect(html).toContain("scanned 2 days ago");
    expect(html).not.toContain("compared");
  });

  it("adds the date of the scan the changes are compared with", () => {
    expect(render(summary(Date.now() / 1000 - 9 * DAY))).toContain(
      "scanned 2 days ago · compared with the scan of 9 days ago",
    );
  });
});
