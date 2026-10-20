import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Disk } from "../../api/types";
import { translate } from "../../i18n";
import { DriveName } from "./DriveName";

const render = (disk: Partial<Disk>, lang: "en" | "ar" = "ar") =>
  renderToStaticMarkup(
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
    </table>,
  );

describe("DriveName", () => {
  it("isolates the mount path, so an unlabeled drive does not read ':C' in Arabic", () => {
    expect(render({})).toContain("<bdi>C:\\</bdi>");
  });

  it("isolates a Unix mount path and keeps the disconnected state next to it", () => {
    const html = render({ mount: "/Volumes/Backup", connected: false });
    expect(html).toContain("<bdi>/Volumes/Backup</bdi>");
    expect(html).toContain(translate("ar", "drives.disconnected"));
  });
});
