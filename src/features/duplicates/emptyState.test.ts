import { describe, expect, it } from "vitest";
import { answer, estimate, group, status } from "./dup.testSupport";
import { emptyKey } from "./emptyState";
import { applyAnswer } from "./groups";

const result = (more: Parameters<typeof answer>[0]) => applyAnswer(null, answer(more));

describe("the empty screen of the duplicates", () => {
  it("asks to open a drive when no root is open", () => {
    const shown = emptyKey({ estimate: estimate({ roots: 0 }), state: null, status: null });
    expect(shown).toBe("dup.noRoots");
  });

  it("does not ask to open a drive while one is still being scanned", () => {
    const shown = emptyKey({
      estimate: estimate({ roots: 0, skipped: ["W:\\"], eligible: 0, seeded: 0 }),
      state: null,
      status: null,
    });
    expect(shown).not.toBe("dup.noRoots");
  });

  it("says every file is left out when the filters pick none", () => {
    const shown = emptyKey({ estimate: estimate({ seeded: 0 }), state: null, status: null });
    expect(shown).toBe("dup.excluded");
  });

  it("says the search was cancelled when it found nothing before", () => {
    const state = result({ job: 1, complete: false });
    expect(emptyKey({ estimate: estimate(), state, status: status({ job: 1 }) })).toBe(
      "dup.cancelled",
    );
  });

  it("is not a cancelled search before the first one: Find is offered", () => {
    expect(emptyKey({ estimate: estimate(), state: result({ job: 0 }), status: status() })).toBe(
      null,
    );
  });

  it("is not cancelled while the search runs", () => {
    const state = result({ job: 1, running: true });
    const running = status({ job: 1, running: true });
    expect(emptyKey({ estimate: estimate(), state, status: running })).toBeNull();
  });

  it("says nothing was found after a whole search", () => {
    const state = result({ job: 1, complete: true });
    expect(emptyKey({ estimate: estimate(), state, status: status({ job: 1 }) })).toBe(
      "dup.notFound",
    );
  });

  it("says nothing was found, not left out, when seeds have no pair", () => {
    const state = result({ job: 1, complete: true });
    const none = estimate({ seeded: 3, files: 0, bytes: 0 });
    expect(emptyKey({ estimate: none, state, status: status({ job: 1 }) })).toBe("dup.notFound");
  });

  it("shows the groups when there are some", () => {
    const state = result({ job: 1, complete: true, groups: [group("a")] });
    expect(emptyKey({ estimate: estimate(), state, status: status({ job: 1 }) })).toBeNull();
  });
});
