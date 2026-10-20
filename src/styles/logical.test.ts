import { describe, expect, it } from "vitest";

const sheets = import.meta.glob<string>("../**/*.css", {
  eager: true,
  query: "?raw",
  import: "default",
});

/** Selectors that stay physical on purpose, each with the reason. */
const ALLOWED: Record<string, string> = {
  // Centred on a pointer coordinate that JS computes (clientX), so both sides are equal.
  ".col-drop": "drop line centred on a JS pointer coordinate",
  // Centred on the screen together with translate(-50%, -50%): mirrors onto itself.
  ".trash-window": "centred on the window, symmetric",
};

const PHYSICAL_PROPERTY =
  /^(margin-(left|right)|padding-(left|right)|border-(left|right)(-[a-z]+)?|left|right)$/;

interface Hit {
  file: string;
  selector: string;
  declaration: string;
}

/** Every physical left/right declaration of a stylesheet, with the selector it sits in. */
function physicalDeclarations(file: string, css: string): Hit[] {
  const hits: Hit[] = [];
  const stack: string[] = [];
  let text = "";
  const check = () => {
    const at = text.indexOf(":");
    if (at > 0) {
      const property = text.slice(0, at).trim().toLowerCase();
      const value = text.slice(at + 1).trim();
      if (
        PHYSICAL_PROPERTY.test(property) ||
        (/^(text-align|float)$/.test(property) && /^(left|right)\b/.test(value))
      ) {
        const selector = stack.at(-1) ?? "";
        hits.push({ file, selector, declaration: `${property}: ${value}` });
      }
    }
    text = "";
  };
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      stack.push(text.trim().replace(/\s+/g, " "));
      text = "";
    } else if (ch === "}") {
      check();
      stack.pop();
    } else if (ch === ";") {
      check();
    } else text += ch;
  }
  return hits;
}

const all = Object.entries(sheets).flatMap(([file, css]) => physicalDeclarations(file, css));

describe("logical CSS properties", () => {
  it("finds the stylesheets", () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(5);
  });

  it("no physical left/right in CSS outside the allowlist", () => {
    const stray = all.filter((h) => !(h.selector in ALLOWED));
    expect(stray.map((h) => `${h.file} ${h.selector} { ${h.declaration} }`)).toEqual([]);
  });

  it("every allowlisted selector still has a physical rule", () => {
    const used = new Set(all.map((h) => h.selector));
    expect(Object.keys(ALLOWED).filter((s) => !used.has(s))).toEqual([]);
  });

  it("mirrors the direction icons in right-to-left layouts", () => {
    const theme = Object.entries(sheets).find(([f]) => f.endsWith("theme.css"))?.[1] ?? "";
    expect(theme).toMatch(/:dir\(rtl\)\s+\.icon-dir\s*\{[^}]*scaleX\(-1\)/);
  });
});
