import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { copy, group } from "./dup.testSupport";
import { GroupDetail } from "./GroupDetail";

vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    lang: "en",
  }),
}));
vi.mock("../../settings/react", () => ({ useSize: () => (n: number) => `${n} B` }));

function elements(node: ReactNode): ReactElement<{ role?: string; children?: ReactNode }>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<{ role?: string; children?: ReactNode }>;
  return [element, ...elements(element.props.children)];
}
const roles = (tree: ReactNode) => elements(tree).flatMap((e) => e.props.role ?? []);

describe("the copies of a group", () => {
  const copies = Array.from({ length: 1234 }, (_, i) => copy(i + 1, { path: `C:\\f${i}.jpg` }));
  const tree = GroupDetail({ group: group("a", 10, { copies }) }) as ReactElement;

  it("is a table until its rows can be reached by the keys", () => {
    expect(roles(tree)).toContain("table");
    expect(roles(tree)).not.toContain("grid");
    expect(roles(tree)).not.toContain("gridcell");
    expect(roles(tree)).toContain("cell");
  });

  it("writes the count of copies with the number format of the language", () => {
    expect(JSON.stringify(tree)).toContain('dup.copies {\\"count\\":1234,\\"copies\\":\\"1,234\\"');
  });

  it("keeps the title on one line that ends in an ellipsis", () => {
    const title = elements(tree).find(
      (e) => (e.props as { className?: string }).className === "dup-name",
    );
    expect(title).toBeDefined();
  });
});
