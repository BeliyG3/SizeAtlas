import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CATEGORY_NAMES } from "../../palette";
import { DEFAULT_UNITS, FiltersPanel } from "./FiltersPanel";

vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));

/** Every element of the tree that satisfies `test`. */
function find(node: ReactNode, test: (props: Record<string, unknown>) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, test));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const props = node.props as Record<string, unknown>;
  return [...(test(props) ? [node] : []), ...find(props.children as ReactNode, test)];
}

interface Control {
  value?: unknown;
  checked?: boolean;
  disabled?: boolean;
  onChange: (e?: unknown) => void;
  onClick: () => void;
}

function setup(text: string, units = DEFAULT_UNITS) {
  const onText = vi.fn();
  const onUnit = vi.fn();
  const onClose = vi.fn();
  const tree = FiltersPanel({ text, onText, units, onUnit, onClose });
  /** The control called `name` (a radio or a checkbox also by its `value`). */
  const named = (name: string, value?: string) =>
    find(tree, (p) => p.name === name && (value === undefined || p.value === value))[0]
      ?.props as Control;
  return { tree, named, onText, onUnit, onClose };
}

const typed = (value: string) => ({ target: { value } });

describe("FiltersPanel shows the conditions of the text", () => {
  it("reads sizes, dates, types and kind", () => {
    const { named } = setup("photo >1GB <3TB older:2w newer:30d type:video type:audio folders");
    expect(named("minSize").value).toBe(1);
    expect(named("minSizeUnit").value).toBe("GB");
    expect(named("maxSize").value).toBe(3);
    expect(named("maxSizeUnit").value).toBe("TB");
    expect(named("olderThan").value).toBe(2);
    expect(named("olderThanUnit").value).toBe("w");
    expect(named("newerThan").value).toBe(30);
    expect(named("newerThanUnit").value).toBe("d");
    expect(CATEGORY_NAMES.filter((c) => named("type", c).checked)).toEqual(["Video", "Audio"]);
    expect(named("kind", "folders").checked).toBe(true);
    expect(named("kind", "both").checked).toBe(false);
  });

  it("starts empty for a text of names only, with the default units", () => {
    const { named } = setup("photo");
    expect(named("minSize").value).toBe("");
    expect(named("minSizeUnit").value).toBe(DEFAULT_UNITS.minSize);
    expect(named("olderThanUnit").value).toBe(DEFAULT_UNITS.olderThan);
    expect(named("kind", "both").checked).toBe(true);
    expect(CATEGORY_NAMES.some((c) => named("type", c).checked)).toBe(false);
  });

  it("names every category as the Types chart does", () => {
    const { tree } = setup("");
    for (const name of CATEGORY_NAMES) expect(JSON.stringify(tree)).toContain(`category.${name}`);
  });
});

describe("FiltersPanel writes the text", () => {
  it("sets a size and keeps the names and the other conditions", () => {
    const { named, onText } = setup("photo type:video >1GB");
    named("minSize").onChange(typed("2"));
    expect(onText).toHaveBeenCalledWith("photo >2GB type:video");
  });

  it("uses the unit it shows, and tells which one", () => {
    const { named, onText, onUnit } = setup("", { ...DEFAULT_UNITS, maxSize: "TB" });
    named("maxSize").onChange(typed("3"));
    expect(onText).toHaveBeenCalledWith("<3TB");
    expect(onUnit).toHaveBeenCalledWith("maxSize", "TB");
  });

  it("changes the unit of a size that is set, and only remembers it when there is none", () => {
    const set = setup("a >1GB");
    set.named("minSizeUnit").onChange(typed("MB"));
    expect(set.onText).toHaveBeenCalledWith("a >1MB");
    expect(set.onUnit).toHaveBeenCalledWith("minSize", "MB");
    const bare = setup("a");
    bare.named("minSizeUnit").onChange(typed("TB"));
    expect(bare.onText).not.toHaveBeenCalled();
    expect(bare.onUnit).toHaveBeenCalledWith("minSize", "TB");
  });

  it("joins the two ends into a range", () => {
    const { named, onText } = setup("a >100MB", { ...DEFAULT_UNITS, maxSize: "GB" });
    named("maxSize").onChange(typed("1"));
    expect(onText).toHaveBeenCalledWith("a 100MB..1GB");
  });

  it("writes dates and fractions", () => {
    const { named, onText } = setup("x");
    named("olderThan").onChange(typed("1"));
    expect(onText).toHaveBeenLastCalledWith("x older:1y");
    named("minSize").onChange(typed("1.5"));
    expect(onText).toHaveBeenLastCalledWith("x >1.5MB");
  });

  it("removes a condition when its number is emptied or is no number", () => {
    const { named, onText } = setup("a >1GB older:1y");
    named("minSize").onChange(typed(""));
    expect(onText).toHaveBeenLastCalledWith("a older:1y");
    named("olderThan").onChange(typed("1e3"));
    expect(onText).toHaveBeenLastCalledWith("a >1GB");
  });

  it("ticks and unticks types", () => {
    const { named, onText } = setup("a type:video");
    named("type", "Audio").onChange();
    expect(onText).toHaveBeenLastCalledWith("a type:video type:audio");
    named("type", "Video").onChange();
    expect(onText).toHaveBeenLastCalledWith("a");
  });

  it("picks files, folders or both", () => {
    const { named, onText } = setup("a files");
    named("kind", "folders").onChange();
    expect(onText).toHaveBeenLastCalledWith("a folders");
    named("kind", "both").onChange();
    expect(onText).toHaveBeenLastCalledWith("a");
  });

  it("clears the conditions and nothing else", () => {
    const { named, onText } = setup("IMG_* >abc >1 GB holiday type:image files");
    named("clear").onClick();
    expect(onText).toHaveBeenCalledWith("IMG_* >abc holiday");
  });

  it("has nothing to clear without conditions", () => {
    expect(setup("a >abc").named("clear").disabled).toBe(true);
    expect(setup("a files").named("clear").disabled).toBe(false);
  });
});

describe("FiltersPanel keys", () => {
  const onKeyDown = (tree: ReactElement) =>
    (tree.props as { onKeyDown: (e: unknown) => void }).onKeyDown;

  it("closes on Escape", () => {
    const { tree, onClose } = setup("");
    const e = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    onKeyDown(tree)(e);
    expect(onClose).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it("leaves other keys alone", () => {
    const { tree, onClose } = setup("");
    onKeyDown(tree)({ key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
