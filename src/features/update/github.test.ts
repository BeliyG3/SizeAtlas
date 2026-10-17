import { describe, expect, it } from "vitest";
import { readRelease } from "./github";

const page = "https://github.com/BeliyG3/SizeAtlas/releases/tag/v2026.11";

describe("readRelease", () => {
  it("reads the shown version from the tag and keeps the release page", () => {
    expect(readRelease({ tag_name: "v2026.11", html_url: page })).toEqual({
      version: "2026.11",
      url: page,
    });
    expect(readRelease({ tag_name: "v2026.11.2", html_url: page })?.version).toBe("2026.11.2");
  });

  it("ignores tags that are not calendar versions", () => {
    for (const tag of ["2026.11", "v2026", "vnext", "v2026.11-beta", "v2026.11.1.1", 7, null]) {
      expect(readRelease({ tag_name: tag, html_url: page })).toBeNull();
    }
  });

  it("ignores drafts, prereleases and answers that are not objects", () => {
    expect(readRelease({ tag_name: "v2026.11", draft: true })).toBeNull();
    expect(readRelease({ tag_name: "v2026.11", prerelease: true })).toBeNull();
    expect(readRelease(null)).toBeNull();
    expect(readRelease("v2026.11")).toBeNull();
  });

  it("falls back to the releases page for a link outside the repository", () => {
    expect(readRelease({ tag_name: "v2026.11", html_url: "https://evil.example/" })?.url).toBe(
      "https://github.com/BeliyG3/SizeAtlas/releases",
    );
    expect(readRelease({ tag_name: "v2026.11" })?.url).toBe(
      "https://github.com/BeliyG3/SizeAtlas/releases",
    );
  });
});
