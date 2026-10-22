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

const searched = (e: KeyboardEvent, field: ReturnType<typeof input>, mac = false) =>
  searchKeyDown(e, field as unknown as HTMLInputElement, mac);

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

  it("uses Cmd+F on a Mac, by the place of the key on any keyboard layout", () => {
    page(false);
    const field = input();
    searched(key({ ctrlKey: false, metaKey: true, key: "а" }), field, true);
    expect(field.focus).toHaveBeenCalled();
  });

  it("leaves Ctrl+F to the text field on a Mac, and Cmd+F to the system elsewhere", () => {
    page(false);
    const field = input();
    const ctrl = key();
    searched(ctrl, field, true);
    const cmd = key({ ctrlKey: false, metaKey: true });
    searched(cmd, field, false);
    expect(field.focus).not.toHaveBeenCalled();
    expect(ctrl.preventDefault).not.toHaveBeenCalled();
    expect(cmd.preventDefault).not.toHaveBeenCalled();
  });

  it("does not focus while a dialog is open, but keeps the webview's find bar away", () => {
    page(true);
    const field = input();
    const e = key();
    searchKeyDown(e, asInput(field));
    expect(field.focus).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("does nothing inside a menu", () => {
    page(false);
    class Menu {
      closest = () => ({});
    }
    vi.stubGlobal("Element", Menu);
    const field = input();
    const e = key({ target: new Menu() as unknown as EventTarget });
    searchKeyDown(e, asInput(field));
    expect(field.focus).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
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
