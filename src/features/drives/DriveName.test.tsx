import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Disk } from "../../api/types";
import { translate } from "../../i18n";
import { I18nProvider } from "../../i18n/react";
import { DriveName } from "./DriveName";

const render = (disk: Partial<Disk>, lang: "en" | "ar" = "ar") => {
  vi.stubGlobal("navigator", { languages: [lang] });
  return renderToStaticMarkup(
    <I18nProvider>
      <table>
        <tbody>
          <tr>
            <DriveName
              disk={{ mount: "C:\\", name: "", connected: true, network: false, ...disk } as Disk}
              saved={undefined}
              t={(key, params) => translate(lang, key, params)}
            />
          </tr>
        </tbody>
      </table>
    </I18nProvider>,
  );
};

describe("DriveName", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("isolates the mount path, so an unlabeled drive does not read ':C' in Arabic", () => {
    expect(render({})).toContain("<bdi>C:\\</bdi>");
  });

  it("isolates a Unix mount path and keeps the disconnected state next to it", () => {
    const html = render({ mount: "/Volumes/Backup", connected: false });
    expect(html).toContain("<bdi>/Volumes/Backup</bdi>");
    expect(html).toContain(translate("ar", "drives.disconnected"));
  });

  it("isolates the tooltip in right-to-left languages only", () => {
    const title = (lang: "en" | "ar") =>
      render({ mount: "/Volumes/Backup", name: "Backup" }, lang).match(/title="([^"]*)"/)?.[1];
    expect(title("ar")).toBe("\u2068/Volumes/Backup Backup\u2069");
    expect(title("en")).toBe("/Volumes/Backup Backup");
  });
});
