import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../../i18n";
import { languageCode } from "./languageCode";

describe("languageCode", () => {
  it("keeps only the base subtag, in capitals", () => {
    expect(languageCode("zh-Hans")).toBe("ZH");
    expect(languageCode("pt-BR")).toBe("PT");
    expect(languageCode("ar")).toBe("AR");
  });

  it("is two letters for every language", () => {
    for (const { code } of LANGUAGES) expect(languageCode(code)).toMatch(/^[A-Z]{2}$/);
  });
});
