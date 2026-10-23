import { describe, expect, it } from "vitest";
import type { ReasonDto, ReasonKind } from "../../api/types";
import { LANGUAGES, translate } from "../../i18n";
import { reasonText } from "./reason";

const en = (key: string, params?: Record<string, string | number>) => translate("en", key, params);
const why = (reason: ReasonKind, restorable: boolean | null = null): ReasonDto => ({
  reason,
  command: null,
  restorable,
});

// Every kind the backend sends: a new one fails to compile here until it has a place below.
const KINDS: Record<ReasonKind, true> = {
  tempOld: true,
  tempLarge: true,
  tempWork: true,
  crashDump: true,
  crashDumpRecent: true,
  errorReport: true,
  windowsCache: true,
  shaderCache: true,
  browserCache: true,
  appCache: true,
  packageCache: true,
  pythonBytecode: true,
  nodeModules: true,
  pythonVenv: true,
  gradleCache: true,
  discordCache: true,
  xcodeDerived: true,
};

describe("the reason of a clean-up row", () => {
  it("has a text in every language for every reason the backend sends", () => {
    for (const lang of LANGUAGES)
      for (const kind of Object.keys(KINDS))
        expect(lang.messages[`reason.${kind}`], `${lang.code} ${kind}`).toBeTruthy();
  });

  it("says why a browser cache can go", () => {
    expect(reasonText(why("browserCache"), en)).toBe("Browser cache — the browser makes it again");
  });

  it("tells a shader cache from the other caches by the way to keep it small", () => {
    const text = reasonText(why("shaderCache"), en);
    expect(text).toContain("limit the shader cache size in the driver panel");
    expect(reasonText(why("appCache"), en)).not.toContain("driver");
  });

  it("adds whether a lock file lies next to the dependencies of a project", () => {
    const base = reasonText(why("nodeModules"), en);
    expect(reasonText(why("nodeModules", true), en)).toBe(
      `${base} · Can be restored: a lock file is next to it`,
    );
    expect(reasonText(why("pythonVenv", false), en)).toContain("No lock file next to it");
    expect(base).not.toContain("lock file");
  });
});
