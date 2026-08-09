import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { Font } from "../src/fonts/font.js";
import { FontRegistry, orderWeights, parseFontFamilyList } from "../src/fonts/resolve.js";

const FONT_PATH = fileURLToPath(
  new URL("../../../tests/fixtures/fonts/DejaVuSansMono.ttf", import.meta.url),
);

let font: Font;

beforeAll(() => {
  font = Font.parse(new Uint8Array(readFileSync(FONT_PATH)));
});

describe("parseFontFamilyList", () => {
  it("splits a computed font-family value", () => {
    expect(parseFontFamilyList("Helvetica, Arial, sans-serif")).toEqual([
      "Helvetica",
      "Arial",
      "sans-serif",
    ]);
  });

  it("keeps quoted names intact, commas and all", () => {
    expect(parseFontFamilyList('"Times New Roman", serif')).toEqual([
      "Times New Roman",
      "serif",
    ]);
    expect(parseFontFamilyList(`'Foo, Bar', serif`)).toEqual(["Foo, Bar", "serif"]);
  });

  it("handles a single family and stray whitespace", () => {
    expect(parseFontFamilyList("  Georgia  ")).toEqual(["Georgia"]);
    expect(parseFontFamilyList("")).toEqual([]);
    expect(parseFontFamilyList("A,,B")).toEqual(["A", "B"]);
  });
});

describe("orderWeights", () => {
  it("prefers an exact match", () => {
    expect(orderWeights(400, [100, 400, 700])[0]).toBe(400);
  });

  it("falls back from 400 to 500 before looking lighter", () => {
    // The CSS special case: 400 tries 500 before searching downward.
    expect(orderWeights(400, [100, 300, 500, 700])[0]).toBe(500);
  });

  it("falls back from 500 to 400 before looking heavier", () => {
    expect(orderWeights(500, [300, 400, 700])[0]).toBe(400);
  });

  it("searches downward first below 400", () => {
    expect(orderWeights(300, [100, 200, 600])[0]).toBe(200);
    expect(orderWeights(300, [600, 900])[0]).toBe(600);
  });

  it("searches upward first above 500", () => {
    expect(orderWeights(700, [300, 400, 900])[0]).toBe(900);
    expect(orderWeights(700, [300, 400])[0]).toBe(400);
  });

  it("returns every candidate exactly once", () => {
    const available = [100, 300, 400, 500, 700, 900];
    const ordered = orderWeights(400, available);
    expect([...ordered].sort((a, b) => a - b)).toEqual(available);
  });

  it("handles an empty set", () => {
    expect(orderWeights(400, [])).toEqual([]);
  });
});

describe("FontRegistry", () => {
  it("matches on family name, case-insensitively", () => {
    const registry = new FontRegistry();
    registry.register({ family: "Test Sans", weight: 400, style: "normal", font });

    expect(registry.resolve({ families: ["test sans"] })?.family).toBe("Test Sans");
    expect(registry.resolve({ families: ["TEST SANS"] })).toBeDefined();
    expect(registry.resolve({ families: ["Nothing"] })).toBeUndefined();
  });

  it("tries families in order", () => {
    const registry = new FontRegistry();
    registry.register({ family: "Second", weight: 400, style: "normal", font });

    expect(registry.resolve({ families: ["First", "Second"] })?.family).toBe("Second");
  });

  it("matches style before weight", () => {
    const registry = new FontRegistry();
    registry.register({ family: "F", weight: 700, style: "italic", font });
    registry.register({ family: "F", weight: 400, style: "normal", font });

    // An italic request takes the italic face even though its weight is further
    // from the requested 400.
    const match = registry.resolve({ families: ["F"], weight: 400, style: "italic" });
    expect(match?.style).toBe("italic");
    expect(match?.weight).toBe(700);
  });

  it("substitutes oblique for italic before falling back to upright", () => {
    const registry = new FontRegistry();
    registry.register({ family: "F", weight: 400, style: "normal", font });
    registry.register({ family: "F", weight: 400, style: "oblique", font });

    expect(registry.resolve({ families: ["F"], style: "italic" })?.style).toBe("oblique");
  });

  it("applies the CSS weight order within a style", () => {
    const registry = new FontRegistry();
    for (const weight of [100, 500, 900]) {
      registry.register({ family: "F", weight, style: "normal", font });
    }

    expect(registry.resolve({ families: ["F"], weight: 400 })?.weight).toBe(500);
    expect(registry.resolve({ families: ["F"], weight: 800 })?.weight).toBe(900);
    expect(registry.resolve({ families: ["F"], weight: 200 })?.weight).toBe(100);
  });

  it("falls back rather than returning nothing when asked", () => {
    const registry = new FontRegistry();
    registry.register({ family: "F", weight: 400, style: "normal", font });

    expect(registry.resolveOrFallback({ families: ["Missing"] })).toBe(font);
  });

  it("explains itself when there is no fallback to give", () => {
    const registry = new FontRegistry();
    expect(() => registry.resolveOrFallback({ families: ["Missing"] })).toThrow(
      /No font registered/,
    );
  });

  it("registers raw bytes with sensible defaults", () => {
    const registry = new FontRegistry();
    registry.registerBytes("Bytes", new Uint8Array(readFileSync(FONT_PATH)));

    const match = registry.resolve({ families: ["Bytes"] });
    expect(match?.weight).toBe(400);
    expect(match?.style).toBe("normal");
  });
});
