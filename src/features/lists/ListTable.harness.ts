// What the ListTable tests share: the props, a render that settles the hook runtime, and the
// keys and elements of the shown table. The test files mock React, the API and the translations.
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import { api } from "../../api/client";
import type { List, ListItem, ListKind, Summary } from "../../api/types";
import { rt } from "./hookRuntime";
import { ListTable } from "./ListTable";

export const summary = {
  generation: 1,
  rev: 3,
  scanning: false,
  baselineAt: null,
  baselineRev: 0,
  baselinePending: false,
  sizeMode: "Allocated",
} as Summary;

export const row = (id: number) =>
  ({ id, name: `f${id}`, isDir: false, deleted: false }) as ListItem;

export const answer = (found: List["found"], items: ListItem[] = []): List => ({
  generation: 1,
  rev: 3,
  size: 500,
  truncated: false,
  items,
  found,
  cleanup: null,
  baselineAt: null,
  baselineRev: 0,
  baselinePending: false,
});

// Stable, as the parent's are: a new one would run the effects again.
export const none = () => {};
export const onTrash = vi.fn();
export const onPurge = vi.fn();
export const onMarks = vi.fn();
export const onEnter = vi.fn();
export const onOpenFolder = vi.fn();
export const onMenu = vi.fn();
const details = new Map();

export let shown: ReactElement | null = null;

export function render(
  query: string,
  leaves = true,
  of: Summary = summary,
  kind: ListKind = "search",
  selectedId = 1,
) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = ListTable({
      summary: of,
      kind,
      query,
      base: 1,
      basePath: "/root",
      parent: 3,
      selectedId,
      details,
      onNeedDetails: none,
      onPick: none,
      onEnter,
      onOpenFolder: leaves ? onOpenFolder : undefined,
      onMenu,
      onTrash,
      onPurge,
      onMarks,
      onFail: none,
    }) as ReactElement;
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the table never settled");
}

export async function settle(query: string) {
  render(query);
  await Promise.resolve();
  render(query);
}

/** The text of every element of the shown tree that has the class `name`. */
export function textOf(name: string): string[] {
  const found: string[] = [];
  const visit = (node: ReactNode) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object" && "props" in node) {
      const props = node.props as { className?: string; children?: ReactNode };
      if (props.className?.split(" ").includes(name)) found.push([props.children].flat().join(""));
      visit(props.children);
    }
  };
  visit(shown);
  return found;
}

/** The grid element and a key pressed in it. */
export const grid = () => (shown!.props as { children: ReactElement[] }).children.flat().at(-1)!;
export function press(key: Partial<KeyboardEvent>) {
  const props = grid().props as { onKeyDown: (e: unknown) => void };
  const target = {};
  props.onKeyDown({ target, currentTarget: target, preventDefault: () => {}, ...key });
}

/** Call in `beforeEach`: a fresh table and fresh spies. */
export function resetTable() {
  rt.state.slots = [];
  vi.mocked(api.getList).mockReset();
  onTrash.mockReset();
  onPurge.mockReset();
  onMarks.mockReset();
  onEnter.mockReset();
  onOpenFolder.mockReset();
  onMenu.mockReset();
}
