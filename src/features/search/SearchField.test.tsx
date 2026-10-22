import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SearchField } from "./SearchField";

vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));

/** Every element of the tree that satisfies `test`. */
function find(node: ReactNode, test: (props: Record<string, unknown>) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, test));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const props = node.props as Record<string, unknown>;
  return [...(test(props) ? [node] : []), ...find(props.children as ReactNode, test)];
}

function setup(value: string) {
  const input = { focus: vi.fn() };
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const tree = SearchField({
    value,
    onChange,
    onCommit,
    inputRef: { current: input as unknown as HTMLInputElement },
  });
  const field = find(tree, (p) => "onKeyDown" in p)[0].props as {
    onKeyDown: (e: unknown) => void;
    onChange: (e: unknown) => void;
    placeholder: string;
    value: string;
    "aria-label": string;
    dir?: string;
    maxLength?: number;
  };
  const clear = find(tree, (p) => p["aria-label"] === "search.clear")[0]?.props as
    { onClick: () => void } | undefined;
  const role = (tree.props as { role?: string }).role;
  return {
    field,
    clear,
    input,
    onChange,
    onCommit,
    role,
    dir: field.dir,
    maxLength: field.maxLength,
  };
}

const keyEvent = (key: string, extra: object = {}) => ({
  key,
  preventDefault: vi.fn(),
  nativeEvent: {},
  ...extra,
});

describe("SearchField", () => {
  it("is labelled and shows the text it was given", () => {
    const { field } = setup("mp4");
    expect(field.value).toBe("mp4");
    expect(field.placeholder).toBe("search.placeholder");
    expect(field["aria-label"]).toBe("search.label");
  });

  it("reports what is typed", () => {
    const { field, onChange } = setup("");
    field.onChange({ target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith("abc");
  });

  it("clears on Escape", () => {
    const { field, onChange } = setup("abc");
    const e = keyEvent("Escape");
    field.onKeyDown(e);
    expect(onChange).toHaveBeenCalledWith("");
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("commits what is typed on Enter", () => {
    const { field, onCommit } = setup("abc");
    field.onKeyDown(keyEvent("Enter"));
    expect(onCommit).toHaveBeenCalledWith("abc");
  });

  it("does not commit while an input method is composing", () => {
    const { field, onCommit } = setup("ab");
    field.onKeyDown(keyEvent("Enter", { nativeEvent: { isComposing: true } }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("treats keyCode 229 as an input method too (WebKit ends the composition first)", () => {
    const { field, onChange, onCommit } = setup("ab");
    field.onKeyDown(keyEvent("Escape", { nativeEvent: { keyCode: 229 } }));
    field.onKeyDown(keyEvent("Enter", { nativeEvent: { keyCode: 229 } }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("reads each way: the text follows its own direction", () => {
    expect(setup("").dir).toBe("auto");
  });

  it("is a search landmark", () => {
    expect(setup("").role).toBe("search");
  });

  it("moves the focus into the results with the Down arrow", () => {
    const grid = { focus: vi.fn() };
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (selector === "[data-search-results]" ? grid : null),
    });
    const { field } = setup("abc");
    const e = keyEvent("ArrowDown");
    field.onKeyDown(e);
    expect(grid.focus).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does nothing with the Down arrow when no results are shown", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    const { field } = setup("abc");
    const e = keyEvent("ArrowDown");
    field.onKeyDown(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("holds as many characters as the search takes", () => {
    expect(setup("").maxLength).toBe(256);
  });

  it("has a clear button that empties the field and keeps the focus there", () => {
    const { clear, onChange, input } = setup("abc");
    clear!.onClick();
    expect(onChange).toHaveBeenCalledWith("");
    expect(input.focus).toHaveBeenCalled();
  });

  it("has no clear button while the field is empty", () => {
    expect(setup("").clear).toBeUndefined();
  });
});
