import { afterEach, describe, expect, it, vi } from "vitest";
import { searchKeyDown } from "./useSearchKey";

const key = (mods: Partial<KeyboardEvent> = {}) =>
  ({
    code: "KeyF",
    key: "f",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    target: null,
    preventDefault: vi.fn(),
    ...mods,
  }) as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };

/** A page with or without an open dialog. */
const page = (dialog: boolean) => {
  vi.stubGlobal("document", { querySelector: () => (dialog ? {} : null) });
  vi.stubGlobal("Element", class {});
};

const input = () => ({ focus: vi.fn(), select: vi.fn() });
const asInput = (field: ReturnType<typeof input>) => field as unknown as HTMLInputElement;

afterEach(() => vi.unstubAllGlobals());

describe("searchKeyDown", () => {
  it("focuses the field and selects its text on Ctrl+F", () => {
    page(false);
    const field = input();
    const e = key();
    searchKeyDown(e, asInput(field));
    expect(field.focus).toHaveBeenCalled();
    expect(field.select).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("does the same on Cmd+F, by the place of the key on any keyboard layout", () => {
    page(false);
    const field = input();
    searchKeyDown(key({ ctrlKey: false, metaKey: true, key: "а" }), asInput(field));
    expect(field.focus).toHaveBeenCalled();
  });

  it("does nothing while a dialog is open, and leaves the key to the page", () => {
    page(true);
    const field = input();
    const e = key();
    searchKeyDown(e, asInput(field));
    expect(field.focus).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("does nothing inside a menu", () => {
    page(false);
    class Menu {
      closest = () => ({});
    }
    vi.stubGlobal("Element", Menu);
    const field = input();
    searchKeyDown(key({ target: new Menu() as unknown as EventTarget }), asInput(field));
    expect(field.focus).not.toHaveBeenCalled();
  });

  it.each([
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["no modifier", { ctrlKey: false }],
    ["another key", { code: "KeyG" }],
    ["a handled key", { defaultPrevented: true }],
  ])("ignores %s", (_, mods) => {
    page(false);
    const field = input();
    searchKeyDown(key(mods), asInput(field));
    expect(field.focus).not.toHaveBeenCalled();
  });

  it("does nothing without a field", () => {
    page(false);
    const e = key();
    searchKeyDown(e, null);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
