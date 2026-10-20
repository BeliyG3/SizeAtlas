import { describe, expect, it } from "vitest";
import type { ListItem } from "../../api/types";
import { pathTitle } from "./pathTitle";

const item = (folder: string, name: string) => ({ folder, name }) as ListItem;

describe("pathTitle", () => {
  it("is the full path: the listed folder, the relative folder and the name", () => {
    expect(pathTitle("D:\\", item("Backups\\System Image", "disk-c-2026-06.vhdx"), "en")).toBe(
      "D:\\Backups\\System Image\\disk-c-2026-06.vhdx",
    );
    expect(pathTitle("D:\\Data", item("", "a.txt"), "en")).toBe("D:\\Data\\a.txt");
    expect(pathTitle("/home/me", item("docs/old", "a.txt"), "en")).toBe("/home/me/docs/old/a.txt");
    expect(pathTitle("/", item("usr", "a"), "en")).toBe("/usr/a");
  });

  it("is isolated in a right-to-left language so the path does not reorder", () => {
    expect(pathTitle("/home/me", item("", "a.txt"), "ar")).toBe("\u2068/home/me/a.txt\u2069");
  });

  it("is absent while the listed folder's path is unknown", () => {
    expect(pathTitle("", item("x", "a.txt"), "en")).toBeUndefined();
    expect(pathTitle("D:\\", undefined, "en")).toBeUndefined();
  });
});
