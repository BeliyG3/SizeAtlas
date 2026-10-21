import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/react";
import { DrivesPanel } from "./DrivesPanel";

vi.mock("../../settings/react", () => ({ useSize: () => String }));

const withStorage = (items: Record<string, string>) => {
  vi.stubGlobal("navigator", { languages: ["en"] });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items[key] ?? null,
    setItem: () => {},
    removeItem: () => {},
  });
  const none = () => {};
  return renderToStaticMarkup(
    <I18nProvider>
      <DrivesPanel sources={null} roots={[]} onOpen={none} onScan={none} onForget={none} />
    </I18nProvider>,
  );
};

describe("DrivesPanel column widths", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ignore widths stored before they were fitted to the content", () => {
    expect(withStorage({ "sizeatlas.drives.columns": '{"size":300}' })).not.toContain(
      "width:300px",
    );
  });

  it("keep widths stored since", () => {
    expect(withStorage({ "sizeatlas.drives.widths": '{"size":300}' })).toContain("width:300px");
  });
});
