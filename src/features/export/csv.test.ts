import { describe, expect, it } from "vitest";
import type { Detail, Item, ListItem } from "../../api/types";
import { cellValue, csvDate, csvField, csvPercent, tableCsv } from "./csv";

const item = (over: Partial<Item> = {}): Item => ({
  id: 1,
  name: "a.txt",
  size: 4096,
  len: 1234,
  files: 0,
  dirs: 0,
  folders: 0,
  modified: 0,
  isDir: false,
  category: 0,
  accessError: false,
  cloud: false,
  lossy: false,
  before: null,
  change: null,
  approxChange: false,
  ...over,
});

describe("csvField", () => {
  it("leaves plain text alone", () => {
    expect(csvField("plain text", ",")).toBe("plain text");
  });

  it("quotes the separator, quotes, CR and LF, doubling inner quotes", () => {
    expect(csvField("a,b", ",")).toBe('"a,b"');
    expect(csvField('say "hi"', ",")).toBe('"say ""hi"""');
    expect(csvField("a\nb", ",")).toBe('"a\nb"');
    expect(csvField("a\rb", ";")).toBe('"a\rb"');
  });

  it("quotes only the separator in use", () => {
    expect(csvField("a,b", ";")).toBe("a,b");
    expect(csvField("a;b", ";")).toBe('"a;b"');
    expect(csvField("a;b", ",")).toBe("a;b");
  });
});

describe("values", () => {
  it("exports provisional sizes only for the active folder, with pending totals blank", () => {
    const pending = item({ isDir: true, pending: true, size: 10, files: 2 });
    for (const column of ["size", "len", "percent", "files", "folders", "dirs"] as const) {
      expect(cellValue(column, pending, undefined, 100)).toBe("");
    }
    const active = { ...pending, scanning: true };
    expect(cellValue("size", active, undefined, 100)).toBe("10");
    expect(cellValue("files", active, undefined, 100)).toBe("2");
    expect(cellValue("len", active, undefined, 100)).toBe("");
  });
  it("writes a share as a percentage with up to two decimals and a dot", () => {
    expect(csvPercent(0.369425)).toBe("36.94");
    expect(csvPercent(1)).toBe("100");
    expect(csvPercent(0.5)).toBe("50");
    expect(csvPercent(0)).toBe("0");
  });

  it("writes a local date and time, empty when unknown", () => {
    const ms = new Date(2024, 0, 2, 3, 4, 5).getTime();
    expect(csvDate(ms)).toBe("2024-01-02 03:04:05");
    expect(csvDate(0)).toBe("");
    expect(csvDate(null)).toBe("");
  });

  it("writes sizes in bytes and counts of folders only", () => {
    const file = item();
    expect(cellValue("len", file, undefined, 0)).toBe("1234");
    expect(cellValue("size", file, undefined, 0)).toBe("4096");
    expect(cellValue("files", file, undefined, 0)).toBe("");
    const dir = item({ isDir: true, files: 1234567, folders: 3, dirs: 9 });
    expect(cellValue("files", dir, undefined, 0)).toBe("1234567");
    expect(cellValue("folders", dir, undefined, 0)).toBe("3");
    expect(cellValue("dirs", dir, undefined, 0)).toBe("9");
  });

  it("takes the percentage of the folder size", () => {
    expect(cellValue("percent", item({ size: 25 }), undefined, 200)).toBe("12.5");
    expect(cellValue("percent", item({ size: 25 }), undefined, 0)).toBe("0");
  });

  it("writes details when read, empty when not", () => {
    const detail: Detail = {
      id: 1,
      created: new Date(2020, 11, 31, 23, 59, 58).getTime(),
      accessed: null,
      attributes: "A",
      owner: null,
    };
    expect(cellValue("created", item(), detail, 0)).toBe("2020-12-31 23:59:58");
    expect(cellValue("accessed", item(), detail, 0)).toBe("");
    expect(cellValue("attributes", item(), detail, 0)).toBe("A");
    expect(cellValue("owner", item(), detail, 0)).toBe("");
    expect(cellValue("attributes", item(), undefined, 0)).toBe("");
  });

  it("writes the change and the size before in signed bytes, empty when unknown", () => {
    const grown = item({ size: 300, before: 100, change: { delta: 200 } });
    expect(cellValue("change", grown, undefined, 0)).toBe("+200");
    expect(cellValue("before", grown, undefined, 0)).toBe("100");
    const shrunk = item({ before: 100, change: { delta: -40 }, approxChange: true });
    expect(cellValue("change", shrunk, undefined, 0)).toBe("-40");
    expect(cellValue("change", item({ before: 7, change: { delta: 0 } }), undefined, 0)).toBe("0");
    const added = item({ size: 4096, change: "new" });
    expect(cellValue("change", added, undefined, 0)).toBe("+4096");
    expect(cellValue("before", added, undefined, 0)).toBe("");
    expect(cellValue("change", item({ before: 1, change: "unknown" }), undefined, 0)).toBe("");
    expect(cellValue("change", item(), undefined, 0)).toBe("");
    expect(cellValue("before", item(), undefined, 0)).toBe("");
    const waiting = item({ isDir: true, pending: true, before: 1, change: { delta: 5 } });
    expect(cellValue("change", waiting, undefined, 0)).toBe("");
  });

  it("writes the folder of a list item as its path", () => {
    const listed: ListItem = { ...item(), folder: "x\\y", parent: 5, deleted: false };
    expect(cellValue("path", listed, undefined, 0)).toBe("x\\y");
    expect(cellValue("path", item(), undefined, 0)).toBe("");
  });
});

describe("tableCsv", () => {
  it("writes a header and one CRLF-ended line per item", () => {
    const text = tableCsv(
      {
        header: ["Full path", "Name", "On disk"],
        columns: ["name", "size"],
        items: [item({ name: "a,b" }), item({ id: 2, name: "c", size: 1 })],
        details: new Map(),
        folderSize: 0,
        pathOf: (i) => `C:\\${i.name}`,
      },
      ",",
    );
    expect(text).toBe('Full path,Name,On disk\r\n"C:\\a,b","a,b",4096\r\nC:\\c,c,1\r\n');
  });

  it("uses the separator it is given", () => {
    const text = tableCsv(
      {
        header: ["P", "Name"],
        columns: ["name"],
        items: [item({ name: "a;b" })],
        details: new Map(),
        folderSize: 0,
        pathOf: () => "p",
      },
      ";",
    );
    expect(text).toBe('P;Name\r\np;"a;b"\r\n');
  });
});
