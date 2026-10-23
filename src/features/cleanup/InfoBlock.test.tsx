import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InfoDto, InfoKind } from "../../api/cleanup";
import { I18nProvider } from "../../i18n/react";
import { InfoBlock } from "./InfoBlock";

vi.mock("../../settings/react", () => ({ useSize: () => (n: number) => `${n} B` }));

const info = (kind: InfoKind, over: Partial<InfoDto> = {}): InfoDto => ({
  kind,
  path: null,
  size: null,
  app: null,
  command: null,
  ...over,
});

const none = () => {};
const render = (lines: InfoDto[], restart: { busy: boolean; run: () => void } | null = null) =>
  renderToStaticMarkup(
    <I18nProvider>
      <InfoBlock info={lines} restart={restart} onCopy={none} />
    </I18nProvider>,
  );

describe("the facts under the total", () => {
  it("says nothing without facts", () => {
    expect(render([])).toBe("");
  });

  it("names the system files with their size, and what to do about them", () => {
    const html = render([
      info("pagefile", { path: "C:\\pagefile.sys", size: 200 }),
      info("hiberfil", { path: "C:\\hiberfil.sys", size: 38 }),
      info("previousWindows", { path: "C:\\Windows.old", size: 9 }),
      info("windowsUpdate", { path: "C:\\Windows\\SoftwareDistribution\\Download", size: 5 }),
      info("deliveryOptimization", { path: "C:\\Windows\\DeliveryOptimization", size: 4 }),
    ]);
    expect(html).toContain("C:\\pagefile.sys (200 B) is the paging file");
    expect(html).toContain("virtual memory settings");
    expect(html).toContain("powercfg /h off");
    expect(html).toContain("C:\\Windows.old (9 B)");
    expect(html).toContain("Temporary files");
    expect(html).toContain("Delivery Optimization");
    expect(html.match(/<li/g)).toHaveLength(5);
    expect(html).not.toContain("<button");
  });

  it("shows the own command of a tool with the note that it deletes at once, and copies it", () => {
    const lines = [info("toolStore", { path: "C:\\uv", size: 24, command: "uv cache clean" })];
    const html = render(lines);
    expect(html).toContain("<code");
    expect(html).toContain("uv cache clean");
    expect(html).toContain("Deletes at once, without the trash");
    expect(html).toContain("Copy clean-up command");
  });

  it("asks to close the running app, with the size its cache would free", () => {
    const html = render([info("appRunning", { app: "Google Chrome", size: 1727 })]);
    expect(html).toContain("Close Google Chrome to clean its cache (1727 B).");
  });

  it("names an unreadable place and offers the restart only when it can work", () => {
    const line = [info("noAccess", { path: "C:\\Windows\\Temp" })];
    expect(render(line)).toContain("C:\\Windows\\Temp");
    expect(render(line)).not.toContain("<button");
    const html = render(line, { busy: false, run: none });
    expect(html).toContain("Restart as administrator");
    expect(html).not.toContain("disabled");
    expect(render(line, { busy: true, run: none })).toContain("disabled");
  });

  it("puts the restart button on the lines of unreadable places only", () => {
    const html = render(
      [info("noAccess", { path: "C:\\a" }), info("appRunning", { app: "Slack", size: 1 })],
      { busy: false, run: none },
    );
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});
