import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/react";
import type { UpdateCheck } from "../update/useUpdateCheck";
import { AppMenuBar } from "./AppMenuBar";

describe("AppMenuBar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ends with the globe as a menu of the bar, after Help", () => {
    vi.stubGlobal("navigator", { languages: ["en"] });
    const none = () => {};
    const html = renderToStaticMarkup(
      <I18nProvider>
        <AppMenuBar
          scanTarget={null}
          rescanTarget={null}
          onRefresh={null}
          refreshIsRescan={false}
          onTrash={null}
          trashNote={null}
          scanning={false}
          forgetTarget={null}
          onChooseFolder={none}
          onExport={null}
          exportSeparator=","
          onScan={none}
          onCancel={none}
          onForget={none}
          onError={none}
          update={{ checkNow: none, auto: false, setAuto: none } as unknown as UpdateCheck}
        />
      </I18nProvider>,
    );
    const titles = [...html.matchAll(/data-menu="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(["file", "scan", "view", "help", "language"]);
  });
});
