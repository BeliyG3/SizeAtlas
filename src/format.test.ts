import { describe, expect, it } from "vitest";
import { formatAgo, formatCount, formatDate, formatPercent, formatSize } from "./format";

describe("formatSize", () => {
  it("uses base 1024 and localized units", () => {
    expect(formatSize(0, "en")).toBe("0 B");
    expect(formatSize(1536, "en")).toBe("1.50 KB");
    expect(formatSize(1536, "ru")).toBe("1,50 КБ");
    expect(formatSize(512 * 1024, "en")).toBe("512 KB");
    expect(formatSize(1.5 * 2 ** 30, "en")).toBe("1.50 GB");
    expect(formatSize(42.3 * 2 ** 40, "en")).toBe("42.3 TB");
  });

  it("moves to the next unit when rounding would reach 1024", () => {
    expect(formatSize(1048575, "en")).toBe("1.00 MB");
    expect(formatSize(1023, "en")).toBe("1,023 B");
    expect(formatSize(10239, "en")).toBe("10.0 KB");
  });

  it("returns a dash for invalid input", () => {
    expect(formatSize(Number.NaN, "en")).toBe("—");
    expect(formatSize(Number.POSITIVE_INFINITY, "en")).toBe("—");
    expect(formatSize(-1, "en")).toBe("—");
  });
});

describe("formatCount", () => {
  it("groups digits per locale", () => {
    expect(formatCount(8227916, "en")).toBe("8,227,916");
    expect(formatCount(8227916, "ru").replace(/\s/g, " ")).toBe("8 227 916");
  });
});

describe("formatAgo", () => {
  const now = Date.UTC(2026, 9, 7, 12, 0, 0);
  it("picks a sensible unit", () => {
    expect(formatAgo(now / 1000 - 30, now, "en")).toBe("now");
    expect(formatAgo(now / 1000 - 2 * 86400, now, "en")).toBe("2 days ago");
    expect(formatAgo(now / 1000 - 2 * 86400, now, "ru")).toBe("2 дня назад");
    expect(formatAgo(now / 1000 - 3 * 3600, now, "en")).toBe("3 hours ago");
  });

  it("returns an empty string for a corrupt time", () => {
    expect(formatAgo(Number.NaN, now, "en")).toBe("");
    expect(formatAgo(Number.POSITIVE_INFINITY, now, "en")).toBe("");
  });
});

describe("formatSize with a fixed unit", () => {
  it("uses two decimals, and none for bytes", () => {
    expect(formatSize(1536, "en", "KB")).toBe("1.50 KB");
    expect(formatSize(1536, "en", "MB")).toBe("0.00 MB");
    expect(formatSize(3 * 2 ** 20, "en", "KB")).toBe("3,072.00 KB");
    expect(formatSize(5 * 2 ** 30, "ru", "GB")).toBe("5,00 ГБ");
    expect(formatSize(1234, "en", "B")).toBe("1,234 B");
    expect(formatSize(-1, "en", "GB")).toBe("—");
  });

  it("keeps the automatic unit by default", () => {
    expect(formatSize(1536, "en", "auto")).toBe("1.50 KB");
  });
});

describe("formatPercent and formatDate", () => {
  it("formats shares with one decimal", () => {
    expect(formatPercent(0.125, "en")).toBe("12.5%");
    expect(formatPercent(0.125, "ru").replace(/\s/g, " ")).toBe("12,5 %");
    expect(formatPercent(Number.NaN, "en")).toBe("—");
  });

  it("formats local dates and dashes unknown ones", () => {
    const noon = Date.UTC(2026, 6, 15, 12);
    expect(formatDate(noon, "en")).toContain("26");
    expect(formatDate(noon, "ru")).toContain("07.2026");
    expect(formatDate(null, "en")).toBe("—");
    expect(formatDate(0, "en")).toBe("—");
  });
});
