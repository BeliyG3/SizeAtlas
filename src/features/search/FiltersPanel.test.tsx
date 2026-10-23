import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CATEGORY_NAMES } from "../../palette";
import { DEFAULT_UNITS, FiltersPanel, NUMBER_FIELDS, type Drafts } from "./FiltersPanel";

// Keys come back as they are; a key with parameters carries them, so that texts built from the
// same key with other parameters differ.
vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: object) => (params ? `${key}${JSON.stringify(params)}` : key),
    lang: "en",
  }),
}));

/** Every element of the tree that satisfies `test`. */
function find(node: ReactNode, test: (props: Record<string, unknown>) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, test));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const props = node.props as Record<string, unknown>;
  return [...(test(props) ? [node] : []), ...find(props.children as ReactNode, test)];
}

interface Control {
  id?: string;
  value?: unknown;
  checked?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  onChange: (e?: unknown) => void;
  onClick: () => void;
}

function setup(text: string, units = DEFAULT_UNITS, drafts: Drafts = {}, tooLong = false) {
  const onText = vi.fn();
  const onUnit = vi.fn();
  const onDraft = vi.fn();
  const onTooLong = vi.fn();
  const onClose = vi.fn();
  const tree = FiltersPanel({
    text,
    onText,
    units,
    onUnit,
    drafts,
    onDraft,
    tooLong,
    onTooLong,
    onClose,
  });
  /** The control called `name` (a radio or a checkbox also by its `value`). */
  const named = (name: string, value?: string) =>
    find(tree, (p) => p.name === name && (value === undefined || p.value === value))[0]
      ?.props as Control;
  const hint = (which: string) => find(tree, (p) => p["data-hint"] === which)[0]?.props;
  return { tree, named, hint, onText, onUnit, onDraft, onTooLong, onClose };
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

  it("labels every number box, and every unit by the box it belongs to", () => {
    const { tree, named } = setup("");
    const labels = find(tree, (p) => typeof p.htmlFor === "string").map(
      (e) => (e.props as { htmlFor: string }).htmlFor,
    );
    expect(labels.sort()).toEqual(NUMBER_FIELDS.map((f) => `filters-${f}`).sort());
    for (const field of NUMBER_FIELDS) expect(named(field).id).toBe(`filters-${field}`);
    const unitLabels = NUMBER_FIELDS.map((f) => named(`${f}Unit`)["aria-label"]);
    expect(new Set(unitLabels).size).toBe(4);
    expect(unitLabels.every((l) => l?.startsWith("filters.unitOf"))).toBe(true);
  });
});

describe("FiltersPanel age units agree with the number", () => {
  /** The labels of the options of the unit box `name`, in order. */
  const labels = (tree: ReactNode, name: string) => {
    const select = find(tree, (p) => p.name === name)[0];
    return find(select, (p) => typeof p.value === "string" && p.children !== undefined)
      .slice(1)
      .map((o) => (o.props as { children: string }).children);
  };

  it("picks the form by the number in the box", () => {
    expect(labels(setup("older:1y").tree, "olderThanUnit")[3]).toBe('filters.age.y{"count":1}');
    expect(labels(setup("older:2y").tree, "olderThanUnit")[3]).toBe('filters.age.y{"count":2}');
    expect(labels(setup("newer:30d").tree, "newerThanUnit")[0]).toBe('filters.age.d{"count":30}');
  });

  it("follows what is typed in a box that is no condition yet, and uses a plural for none", () => {
    const draft = setup("", DEFAULT_UNITS, { olderThan: "1.5" });
    expect(labels(draft.tree, "olderThanUnit")[3]).toBe('filters.age.y{"count":1.5}');
    expect(labels(setup("").tree, "olderThanUnit")[3]).toBe('filters.age.y{"count":5}');
    const bad = setup("", DEFAULT_UNITS, { newerThan: "abc" });
    expect(labels(bad.tree, "newerThanUnit")[3]).toBe('filters.age.y{"count":5}');
  });
});

describe("FiltersPanel writes the text", () => {
  it("sets a size and keeps the names and the other conditions", () => {
    const { named, onText } = setup("photo type:video >1GB");
    named("minSize").onChange(typed("2"));
    expect(onText).toHaveBeenCalledWith("photo >=2GB type:video");
  });

  it("keeps a size typed with >= and <= when something else changes", () => {
    const { named, onText } = setup("a >=1GB");
    named("type", "Video").onChange();
    expect(onText).toHaveBeenCalledWith("a >=1GB type:video");
    const upper = setup("a <=1GB");
    upper.named("kind", "files").onChange();
    expect(upper.onText).toHaveBeenCalledWith("a <=1GB files");
  });

  it("takes 0 as a lower limit", () => {
    const { named, onText } = setup("a");
    named("minSize").onChange(typed("0"));
    expect(onText).toHaveBeenCalledWith("a >=0MB");
  });

  it("uses the unit it shows, and tells which one", () => {
    const { named, onText, onUnit } = setup("", { ...DEFAULT_UNITS, maxSize: "TB" });
    named("maxSize").onChange(typed("3"));
    expect(onText).toHaveBeenCalledWith("<=3TB");
    expect(onUnit).toHaveBeenCalledWith("maxSize", "TB");
  });

  it("changes the unit of a size that is set, and only remembers it when there is none", () => {
    const set = setup("a >1GB");
    set.named("minSizeUnit").onChange(typed("MB"));
    expect(set.onText).toHaveBeenCalledWith("a >=1MB");
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
    expect(onText).toHaveBeenLastCalledWith("x >=1.5MB");
  });

  it("removes a condition when its number is emptied or is no number", () => {
    const { named, onText } = setup("a >1GB older:1y");
    named("minSize").onChange(typed(""));
    expect(onText).toHaveBeenLastCalledWith("a older:1y");
    named("olderThan").onChange(typed("1e3"));
    expect(onText).toHaveBeenLastCalledWith("a >=1GB");
  });

  it("never writes a number that would be a name word", () => {
    const { named, onText } = setup("a");
    named("olderThan").onChange(typed("1.5"));
    expect(onText).toHaveBeenLastCalledWith("a");
    named("minSize").onChange(typed("0.0000000000000000001"));
    expect(onText).toHaveBeenLastCalledWith("a");
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

  it("clears the conditions and nothing else, and what was typed in the boxes", () => {
    const { named, onText, onDraft, onTooLong } = setup(
      "IMG_* >abc >1 GB holiday type:image files",
    );
    named("clear").onClick();
    expect(onText).toHaveBeenCalledWith("IMG_* >abc holiday");
    for (const field of NUMBER_FIELDS) expect(onDraft).toHaveBeenCalledWith(field, undefined);
    expect(onTooLong).toHaveBeenCalledWith(false);
  });

  it("has nothing to clear without conditions or drafts", () => {
    expect(setup("a >abc").named("clear").disabled).toBe(true);
    expect(setup("a files").named("clear").disabled).toBe(false);
    expect(setup("a", DEFAULT_UNITS, { minSize: "1e3" }).named("clear").disabled).toBe(false);
  });
});

describe("FiltersPanel keeps what was typed in a number box", () => {
  it("remembers a text that is no condition, and forgets it once it is one", () => {
    const { named, onDraft } = setup("a");
    named("minSize").onChange(typed("1e3"));
    expect(onDraft).toHaveBeenLastCalledWith("minSize", "1e3");
    named("minSize").onChange(typed("12"));
    expect(onDraft).toHaveBeenLastCalledWith("minSize", undefined);
    named("minSize").onChange(typed(""));
    expect(onDraft).toHaveBeenLastCalledWith("minSize", undefined);
  });

  it("shows the draft in the box, marked invalid", () => {
    const { named } = setup("a", DEFAULT_UNITS, { olderThan: "1.5" });
    expect(named("olderThan").value).toBe("1.5");
    expect(named("olderThan")["aria-invalid"]).toBe(true);
    expect(named("newerThan")["aria-invalid"]).toBe(false);
  });
});

describe("FiltersPanel and the 256 characters of the search", () => {
  it("refuses a write that would be longer, and says so", () => {
    const { named, onText, onTooLong, onDraft } = setup("x".repeat(252));
    named("type", "Video").onChange();
    expect(onText).not.toHaveBeenCalled();
    expect(onTooLong).toHaveBeenLastCalledWith(true);
    named("minSize").onChange(typed("5"));
    expect(onText).not.toHaveBeenCalled();
    // The number stays in the box, as typed.
    expect(onDraft).toHaveBeenLastCalledWith("minSize", "5");
  });

  it("counts characters, not UTF-16 units", () => {
    // 240 emoji are 480 UTF-16 units but 240 characters: " type:video" still fits.
    const { named, onText, onTooLong } = setup("😀".repeat(240));
    named("type", "Video").onChange();
    expect(onText).toHaveBeenCalledWith(`${"😀".repeat(240)} type:video`);
    expect(onTooLong).toHaveBeenLastCalledWith(false);
  });

  it("writes up to exactly 256", () => {
    const name = "x".repeat(256 - " type:video".length);
    const { named, onText } = setup(name);
    named("type", "Video").onChange();
    expect(onText).toHaveBeenCalledWith(`${name} type:video`);
  });

  it("shows the hint while it applies", () => {
    expect(setup("a", DEFAULT_UNITS, {}, true).hint("long")).toBeDefined();
    expect(setup("a").hint("long")).toBeUndefined();
  });
});

describe("FiltersPanel hints", () => {
  it("says when the lower size is above the upper one, and marks both boxes", () => {
    const { hint, named } = setup("a >=2GB <=1GB");
    expect(hint("size")).toBeDefined();
    expect(named("minSize")["aria-invalid"]).toBe(true);
    expect(named("maxSize")["aria-invalid"]).toBe(true);
    expect(setup("a 1GB..2GB").hint("size")).toBeUndefined();
  });

  it("says when 'older than' is longer than 'within the last'", () => {
    expect(setup("older:1y newer:30d").hint("age")).toBeDefined();
    expect(setup("older:30d newer:1y").hint("age")).toBeUndefined();
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
