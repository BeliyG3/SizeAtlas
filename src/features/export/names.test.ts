import { describe, expect, it } from "vitest";
import { exportFileName, joinPath } from "./names";

describe("joinPath", () => {
  it("joins with the separator of the root, without doubling it", () => {
    expect(joinPath(["C:\\", "Users", "a.txt"])).toBe("C:\\Users\\a.txt");
    expect(joinPath(["D:\\Data", "x"])).toBe("D:\\Data\\x");
    expect(joinPath(["/", "home", "a"])).toBe("/home/a");
    expect(joinPath(["/srv/data", "", "a"])).toBe("/srv/data/a");
  });
});

describe("exportFileName", () => {
  const day = new Date(2026, 9, 9, 23, 30);

  it("names the file after the table and the day", () => {
    expect(exportFileName("Largest files", day)).toBe("SizeAtlas - Largest files - 2026-10-09.csv");
  });

  it("keeps the last part of a root path and drops characters Windows refuses", () => {
    expect(exportFileName("C:\\", day)).toBe("SizeAtlas - C - 2026-10-09.csv");
    expect(exportFileName("D:\\Work\\Pro*j?", day)).toBe("SizeAtlas - Proj - 2026-10-09.csv");
    expect(exportFileName('a<b>c"d|e. ', day)).toBe("SizeAtlas - abcde - 2026-10-09.csv");
  });

  it("leaves the name out when nothing of it is left", () => {
    expect(exportFileName("/", day)).toBe("SizeAtlas - 2026-10-09.csv");
  });
});
