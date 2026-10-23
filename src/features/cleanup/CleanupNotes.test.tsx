import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CleanupDto, List } from "../../api/types";
import { I18nProvider } from "../../i18n/react";
import { CleanupNotes } from "./CleanupNotes";

vi.mock("../../api/client", () => ({
  api: { isElevated: vi.fn(() => Promise.resolve(false)), copyText: vi.fn() },
}));
vi.mock("../../settings/react", () => ({ useSize: () => (n: number) => `${n} B` }));

const DAY = 24 * 60 * 60;
const FRESH = Date.now() / 1000 - 60;

type Answer = Pick<List, "found" | "cleanup">;
const answer = (found: List["found"], cleanup: Partial<CleanupDto> = {}): Answer => ({
  found,
  cleanup: { info: [], approximate: false, ...cleanup },
});

const render = (
  list: Answer,
  summary: { scannedAt: number; scanning?: boolean } = { scannedAt: FRESH },
) =>
  renderToStaticMarkup(
    <I18nProvider>
      <CleanupNotes list={list} summary={{ root: "C:\\", ...summary }} onFail={() => {}} />
    </I18nProvider>,
  );

describe("the notes of a clean-up list", () => {
  it("says how much was found in how many places, as a status", () => {
    const html = render(answer({ count: 1234, size: 2048 }));
    expect(html).toContain("Found 2048 B in 1,234 places");
    expect(html).toContain('role="status"');
  });

  it("says one place in the singular", () => {
    expect(render(answer({ count: 1, size: 5 }))).toContain("Found 5 B in 1 place<");
  });

  it("puts ≈ before the size when something was read in part", () => {
    const html = render(answer({ count: 3, size: 7 }, { approximate: true }));
    expect(html).toContain("Found ≈7 B in 3 places");
  });

  it("shows no total when nothing was found, but still the facts", () => {
    const html = render(
      answer(
        { count: 0, size: 0 },
        { info: [{ kind: "appRunning", app: "Slack", size: 3, path: null, command: null }] },
      ),
    );
    expect(html).not.toContain("Found");
    expect(html).toContain("Close Slack");
  });

  it("asks to scan again when the scan is more than a day old", () => {
    const html = render(answer({ count: 1, size: 1 }), { scannedAt: Date.now() / 1000 - 3 * DAY });
    expect(html).toContain("Scanned 3 days ago. Rescan for an exact list.");
    expect(render(answer({ count: 1, size: 1 }))).not.toContain("Rescan");
  });

  it("does not ask for a rescan of a scan that is still running", () => {
    const html = render(answer({ count: 1, size: 1 }), {
      scannedAt: Date.now() / 1000 - 3 * DAY,
      scanning: true,
    });
    expect(html).not.toContain("Rescan");
  });

  it("renders nothing without anything to say", () => {
    expect(render(answer(null))).toBe("");
  });
});
