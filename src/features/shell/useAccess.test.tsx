import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Summary } from "../../api/types";
import { I18nProvider } from "../../i18n/react";
import type { AccessState } from "./accessState";
import { useAccess } from "./useAccess";

const mocks = vi.hoisted(() => ({
  state: null as unknown as AccessState,
  dismissed: false,
  dismiss: vi.fn(),
}));
vi.mock("./accessState", () => ({ useAccessState: () => mocks.state }));
vi.mock("./accessDismissed", () => ({
  useAccessDismissed: () => ({ isDismissed: () => mocks.dismissed, dismiss: mocks.dismiss }),
}));
// The restart hook asks the backend only when its button is pressed.
vi.mock("../../api/client", () => ({ api: {}, isCmdError: () => false }));

const state = (
  os: AccessState["os"],
  elevated: boolean | null,
  fullDiskAccess: boolean | null,
  actionable: boolean | null,
): AccessState => ({ os, elevated, fullDiskAccess, actionable });

const summary = (accessErrors: number) =>
  ({ root: "C:\\", scannedAt: 100, accessErrors }) as Summary;

function Notices({ s }: { s: Summary | null }) {
  const { banner, chip } = useAccess(s, { push: vi.fn(), errorText: String, onShow: vi.fn() });
  return (
    <>
      {banner}
      <footer>{chip}</footer>
    </>
  );
}

const render = (s: Summary | null) =>
  renderToStaticMarkup(
    <I18nProvider>
      <Notices s={s} />
    </I18nProvider>,
  );

const BANNER = /<p class="banner" role="note"/;

beforeEach(() => {
  mocks.dismissed = false;
});

describe("useAccess", () => {
  it("shows nothing when every folder was read", () => {
    mocks.state = state("windows", false, null, true);
    expect(render(summary(0))).not.toContain("access-chip");
    expect(render(null)).not.toContain("access-chip");
  });

  it("shows the banner, with a way to close it, and the chip when there is something to do", () => {
    mocks.state = state("windows", false, null, true);
    const html = render(summary(184));
    expect(html).toMatch(BANNER);
    expect(html).toContain('class="close"');
    expect(html).toContain("Restart as administrator");
    expect(html).toContain("access-chip");
    expect(html).toContain("184");
  });

  it.each([
    ["an administrator", state("windows", true, null, false)],
    ["a Mac with Full Disk Access", state("mac", null, true, false)],
    ["Linux", state("other", null, null, false)],
  ])("shows the chip alone for %s", (_, known) => {
    mocks.state = known;
    const html = render(summary(184));
    expect(html).not.toMatch(BANNER);
    expect(html).toContain("access-chip");
  });

  it("shows the chip alone while the rights are still unknown", () => {
    mocks.state = state("windows", null, null, null);
    const html = render(summary(184));
    expect(html).not.toMatch(BANNER);
    expect(html).toContain("access-chip");
  });

  it("keeps the chip when the banner was closed for this scan", () => {
    mocks.state = state("mac", null, false, true);
    mocks.dismissed = true;
    const html = render(summary(184));
    expect(html).not.toMatch(BANNER);
    expect(html).toContain("access-chip");
  });
});
