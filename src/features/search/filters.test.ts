import { describe, expect, it } from "vitest";
import {
  MAX_QUERY,
  conflicts,
  formatFilters,
  numberFromText,
  parseFilters,
  withNumber,
  type UiFilters,
} from "./filters";

const none: UiFilters = { types: [] };
const parsed = (text: string) => parseFilters(text);

describe("parseFilters: sizes", () => {
  it("reads compact sizes", () => {
    expect(parsed(">1GB").filters.minSize).toEqual({ value: 1, unit: "GB" });
    expect(parsed("<10MB").filters.maxSize).toEqual({ value: 10, unit: "MB" });
    expect(parsed(">=2kb").filters.minSize).toEqual({ value: 2, unit: "KB" });
    expect(parsed("<=3TB").filters.maxSize).toEqual({ value: 3, unit: "TB" });
  });

  it("reads a range as both ends, each with its own unit", () => {
    const { filters } = parsed("100MB..1GB");
    expect(filters.minSize).toEqual({ value: 100, unit: "MB" });
    expect(filters.maxSize).toEqual({ value: 1, unit: "GB" });
    expect(parsed("100..1GB").filters.minSize).toEqual({ value: 100, unit: "B" });
  });

  it("reads fractions, either separator, and Russian units", () => {
    expect(parsed(">1,5ГБ").filters.minSize).toEqual({ value: 1.5, unit: "GB" });
    expect(parsed(">1.5gb").filters.minSize).toEqual({ value: 1.5, unit: "GB" });
    expect(parsed("<=500мб").filters.maxSize).toEqual({ value: 500, unit: "MB" });
  });

  it("reads a bare number as bytes", () => {
    expect(parsed(">500").filters.minSize).toEqual({ value: 500, unit: "B" });
  });

  it("takes a unit set apart by a space as part of the size", () => {
    const { words, filters } = parsed(">1 GB photo");
    expect(filters.minSize).toEqual({ value: 1, unit: "GB" });
    expect(words).toBe("photo");
    expect(parsed("100MB..1 gb").filters.maxSize).toEqual({ value: 1, unit: "GB" });
    expect(parsed(">=1,5 ГБ").filters.minSize).toEqual({ value: 1.5, unit: "GB" });
  });

  it("keeps a word that is not a unit, and a unit after a size that has one", () => {
    expect(parsed(">1 photo").words).toBe("photo");
    expect(parsed(">1 photo").filters.minSize).toEqual({ value: 1, unit: "B" });
    const kept = parsed(">1GB gb");
    expect(kept.words).toBe("gb");
    expect(kept.filters.minSize).toEqual({ value: 1, unit: "GB" });
    expect(parsed("> 1GB").words).toBe("> 1GB");
    expect(parsed("100 MB..1GB").filters.minSize).toBeUndefined();
  });

  it("keeps the tighter of two bounds of one kind", () => {
    expect(parsed(">1GB >500MB").filters.minSize).toEqual({ value: 1, unit: "GB" });
    expect(parsed("<1GB <500MB").filters.maxSize).toEqual({ value: 500, unit: "MB" });
  });
});

describe("parseFilters: half-typed and invalid conditions stay name words", () => {
  it.each([
    ">",
    ">abc",
    ">1XB",
    ">-1",
    ">+5",
    ">1.",
    "<0",
    "<0MB",
    "1GB",
    "100MB..",
    "..1GB",
    "a..b",
    "2019..2020",
    "1GB..100MB",
    "type:",
    "type:foo",
    "older:",
    "older:1",
    "older:d",
    "older:1.5y",
    "older:-1d",
    "older:+5d",
    "newer:1x",
    "file",
    "filesystem",
  ])("%s", (word) => {
    const { words, filters } = parsed(`photo ${word}`);
    expect(words).toBe(`photo ${word}`);
    expect(filters).toEqual(none);
  });

  it("is not fooled by words that are properties of every object", () => {
    expect(parsed(">1 constructor").words).toBe("constructor");
    expect(parsed("older:1constructor toString").words).toBe("older:1constructor toString");
  });

  it("does not read a number too long for a size", () => {
    const word = `>${"9".repeat(40)}`;
    expect(parsed(word).words).toBe(word);
  });
});

describe("parseFilters: dates, types, kind", () => {
  it("reads older and newer in every unit, in any case", () => {
    expect(parsed("older:1y").filters.olderThan).toEqual({ value: 1, unit: "y" });
    expect(parsed("NEWER:30D").filters.newerThan).toEqual({ value: 30, unit: "d" });
    expect(parsed("older:2w").filters.olderThan).toEqual({ value: 2, unit: "w" });
    expect(parsed("newer:6m").filters.newerThan).toEqual({ value: 6, unit: "m" });
  });

  it("keeps the largest older and the smallest newer", () => {
    expect(parsed("older:1y older:2w").filters.olderThan).toEqual({ value: 1, unit: "y" });
    expect(parsed("newer:1y newer:2w").filters.newerThan).toEqual({ value: 2, unit: "w" });
  });

  it("reads types, singular or plural, without repeats", () => {
    expect(parsed("type:video type:Images type:video type:programs").filters.types).toEqual([
      "Video",
      "Images",
      "Executables",
    ]);
    expect(
      parsed("type:document type:archives type:code type:other type:audio").filters.types,
    ).toEqual(["Documents", "Archives", "Code", "Other", "Audio"]);
  });

  it("reads files and folders, the last one winning", () => {
    expect(parsed("files").filters.kind).toBe("files");
    expect(parsed("files FOLDERS").filters.kind).toBe("folders");
  });
});

describe("formatFilters", () => {
  it("writes the compact forms after the name words", () => {
    const text = formatFilters("photo", {
      minSize: { value: 1, unit: "GB" },
      olderThan: { value: 1, unit: "y" },
      newerThan: { value: 30, unit: "d" },
      types: ["Video", "Audio"],
      kind: "files",
    });
    expect(text).toBe("photo >=1GB older:1y newer:30d type:video type:audio files");
  });

  it("writes one range for both size ends, and a lone bound as >= or <=", () => {
    const both = {
      minSize: { value: 100, unit: "MB" as const },
      maxSize: { value: 1, unit: "GB" as const },
    };
    expect(formatFilters("", { ...none, ...both })).toBe("100MB..1GB");
    expect(formatFilters("", { ...none, maxSize: both.maxSize })).toBe("<=1GB");
    expect(formatFilters("", { ...none, minSize: both.minSize })).toBe(">=100MB");
  });

  it("does not write a range that its own grammar would refuse", () => {
    const text = formatFilters("", {
      ...none,
      minSize: { value: 2, unit: "GB" },
      maxSize: { value: 1, unit: "GB" },
    });
    expect(text).toBe(">=2GB <=1GB");
    expect(parsed(text).filters).toMatchObject({
      minSize: { value: 2, unit: "GB" },
      maxSize: { value: 1, unit: "GB" },
    });
  });

  it("writes a bound of 0 and a bound under a byte: both are conditions", () => {
    expect(formatFilters("", { ...none, minSize: { value: 0, unit: "MB" } })).toBe(">=0MB");
    expect(formatFilters("", { ...none, maxSize: { value: 0, unit: "MB" } })).toBe("<=0MB");
    const text = formatFilters("", { ...none, maxSize: { value: 0.1, unit: "B" } });
    expect(text).toBe("<=0.1B");
    expect(parsed(text).filters.maxSize).toEqual({ value: 0.1, unit: "B" });
  });

  it("writes fractions and tiny numbers in plain digits", () => {
    expect(formatFilters("", { ...none, minSize: { value: 1.5, unit: "GB" } })).toBe(">=1.5GB");
    const tiny = formatFilters("", { ...none, minSize: { value: 1e-7, unit: "B" } });
    expect(tiny).toBe(">=0.0000001B");
    expect(parsed(tiny).filters.minSize).toBeDefined();
    // Never a number like `0.`: it is no size.
    expect(formatFilters("", { ...none, minSize: { value: 1e-25, unit: "GB" } })).toBe(">=0GB");
  });

  it("is the name words alone with no conditions", () => {
    expect(formatFilters("  a   b ", none)).toBe("a b");
    expect(formatFilters("", none)).toBe("");
  });
});

describe("the panel round trip", () => {
  it("shows what was typed, keeps the name when a condition changes", () => {
    const { words, filters } = parsed("photo type:video >1GB");
    expect(words).toBe("photo");
    expect(filters.types).toEqual(["Video"]);
    expect(filters.minSize).toEqual({ value: 1, unit: "GB" });
    const next = formatFilters(words, { ...filters, minSize: { value: 2, unit: "GB" } });
    expect(next).toBe("photo >=2GB type:video");
    expect(parsed(next).words).toBe("photo");
  });

  it("ticking a type keeps a size that was typed with >= and <=", () => {
    const { words, filters } = parsed(">=1GB <=2GB a");
    expect(formatFilters(words, { ...filters, types: ["Video"] })).toBe("a 1GB..2GB type:video");
    const lone = parsed("a >=1GB");
    expect(formatFilters(lone.words, { ...lone.filters, types: ["Video"] })).toBe(
      "a >=1GB type:video",
    );
    const upper = parsed("a <=1GB");
    expect(formatFilters(upper.words, { ...upper.filters, kind: "files" })).toBe("a <=1GB files");
  });

  it("clearing removes only the condition words, in their order", () => {
    const { words } = parsed("IMG_* .jpg >1 GB older:1y holiday type:image files");
    expect(formatFilters(words, none)).toBe("IMG_* .jpg holiday");
  });

  it("keeps invalid condition-looking words as name words through an edit", () => {
    const { words, filters } = parsed("a >abc type:foo older:1 >1GB");
    expect(words).toBe("a >abc type:foo older:1");
    expect(formatFilters(words, { ...filters, minSize: undefined })).toBe(
      "a >abc type:foo older:1",
    );
  });

  it("reads back what it wrote", () => {
    const filters: UiFilters = {
      minSize: { value: 1.5, unit: "GB" },
      maxSize: { value: 2, unit: "TB" },
      olderThan: { value: 2, unit: "w" },
      newerThan: { value: 6, unit: "m" },
      types: ["Documents", "Executables"],
      kind: "folders",
    };
    expect(parsed(formatFilters("a b", filters))).toEqual({ words: "a b", filters });
  });
});

describe("tightening works on the limits the core resolves", () => {
  it("compares > and < by the byte they exclude", () => {
    expect(parsed(">1KB >=1026").filters.minSize).toEqual({ value: 1026, unit: "B" });
    expect(parsed(">=1026 >1KB").filters.minSize).toEqual({ value: 1026, unit: "B" });
    expect(parsed("<=1024 <1KB").filters.maxSize).toEqual({ value: 1, unit: "KB" });
    expect(parsed("<1KB <=1022").filters.maxSize).toEqual({ value: 1022, unit: "B" });
  });
});

describe("whitespace", () => {
  it("splits on Unicode white space like the core, but not on U+FEFF", () => {
    expect(parsed("a\u00a0>=1GB").words).toBe("a");
    expect(parsed("a\u0085>=1GB").filters.minSize).toEqual({ value: 1, unit: "GB" });
    expect(parsed("a\ufeff>=1GB").words).toBe("a\ufeff>=1GB");
    expect(formatFilters("a\u00a0 b", none)).toBe("a b");
  });
});

describe("numberFromText", () => {
  it("takes the numbers the search understands", () => {
    expect(numberFromText("minSize", "1", "GB")).toBe(1);
    expect(numberFromText("maxSize", "0.1", "B")).toBe(0.1);
    expect(numberFromText("minSize", "0", "MB")).toBe(0);
    expect(numberFromText("olderThan", "30", "d")).toBe(30);
  });

  it.each(["", "-", "-1", "+1", "1e3", "1e", ".5", "1.", "1,5", " 1", "0x10", "\u0663"])(
    "refuses %j",
    (raw) => {
      expect(numberFromText("minSize", raw, "MB")).toBeUndefined();
      expect(numberFromText("olderThan", raw, "d")).toBeUndefined();
    },
  );

  it("refuses what no condition could hold", () => {
    expect(numberFromText("olderThan", "1.5", "y")).toBeUndefined();
    expect(numberFromText("newerThan", "99999999999", "y")).toBeUndefined();
    expect(numberFromText("minSize", "0.0000000000000000001", "GB")).toBeUndefined();
    expect(numberFromText("minSize", "9".repeat(40), "B")).toBeUndefined();
    expect(numberFromText("minSize", "9".repeat(30), "TB")).toBeDefined();
  });
});

describe("withNumber", () => {
  it("drops a number that cannot be written", () => {
    const base: UiFilters = { types: [], olderThan: { value: 1, unit: "y" } };
    expect(withNumber(base, "olderThan", 99999999999, "y").olderThan).toBeUndefined();
    expect(withNumber(base, "olderThan", 1.5, "y").olderThan).toBeUndefined();
    expect(withNumber(base, "olderThan", 3, "w").olderThan).toEqual({ value: 3, unit: "w" });
  });
});

describe("conflicts", () => {
  it("tells a lower size limit above the upper one", () => {
    const f = (min: UiFilters["minSize"], max: UiFilters["maxSize"]) =>
      conflicts({ types: [], minSize: min, maxSize: max });
    expect(f({ value: 2, unit: "GB" }, { value: 1, unit: "GB" }).size).toBe(true);
    expect(f({ value: 1, unit: "GB" }, { value: 1024, unit: "MB" }).size).toBe(false);
    expect(f({ value: 1, unit: "GB" }, undefined).size).toBe(false);
  });

  it("tells an older-than limit longer than the within-the-last one", () => {
    const f = (older: UiFilters["olderThan"], newer: UiFilters["newerThan"]) =>
      conflicts({ types: [], olderThan: older, newerThan: newer });
    expect(f({ value: 1, unit: "y" }, { value: 30, unit: "d" }).age).toBe(true);
    expect(f({ value: 30, unit: "d" }, { value: 1, unit: "y" }).age).toBe(false);
    expect(f({ value: 4, unit: "w" }, { value: 28, unit: "d" }).age).toBe(false);
  });
});

it("takes as many characters as the core: 256", () => {
  expect(MAX_QUERY).toBe(256);
});
