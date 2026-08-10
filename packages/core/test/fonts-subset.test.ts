import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { Font } from "../src/fonts/font.js";
import { closeOverComponents, isComposite, parseComponents, parseLoca } from "../src/fonts/glyf.js";
import { parseSfnt } from "../src/fonts/sfnt.js";
import { subsetFont } from "../src/fonts/subset.js";
import {
  parseAdvanceWidths,
  parseHead,
  parseHhea,
  parseMaxpNumGlyphs,
} from "../src/fonts/tables.js";

const FONT_PATH = fileURLToPath(
  new URL("../../../tests/fixtures/fonts/DejaVuSansMono.ttf", import.meta.url),
);

let bytes: Uint8Array;
let font: Font;

beforeAll(() => {
  bytes = new Uint8Array(readFileSync(FONT_PATH));
  font = Font.parse(bytes);
});

const glyphsFor = (text: string): number[] =>
  [...text].map((character) => font.glyphForCodePoint(character.codePointAt(0) as number));

describe("composite glyphs", () => {
  it("finds the components of an accented character", () => {
    const sfnt = parseSfnt(bytes);
    const head = parseHead(sfnt);
    const numGlyphs = parseMaxpNumGlyphs(sfnt);
    const loca = parseLoca(sfnt, numGlyphs, head.indexToLocFormat);
    const glyf = sfnt.table("glyf");

    const eAcute = font.glyphForCodePoint("é".codePointAt(0) as number);
    const start = loca[eAcute] as number;
    const end = loca[eAcute + 1] as number;
    const data = glyf.subarray(start, end);

    expect(isComposite(data)).toBe(true);

    const components = parseComponents(data);
    expect(components.length).toBeGreaterThanOrEqual(2);

    // One component is the base "e".
    const plainE = font.glyphForCodePoint("e".codePointAt(0) as number);
    expect(components.map((component) => component.glyphIndex)).toContain(plainE);
  });

  it("pulls components into the subset even when not requested directly", () => {
    const sfnt = parseSfnt(bytes);
    const head = parseHead(sfnt);
    const numGlyphs = parseMaxpNumGlyphs(sfnt);
    const loca = parseLoca(sfnt, numGlyphs, head.indexToLocFormat);
    const glyf = sfnt.table("glyf");

    const eAcute = font.glyphForCodePoint("é".codePointAt(0) as number);
    const plainE = font.glyphForCodePoint("e".codePointAt(0) as number);

    const closure = closeOverComponents([eAcute], glyf, loca, numGlyphs);
    expect(closure.has(eAcute)).toBe(true);
    expect(closure.has(plainE)).toBe(true);
    // .notdef is mandatory.
    expect(closure.has(0)).toBe(true);
  });
});

describe("subsetting", () => {
  it("keeps the requested glyphs in the order given, with .notdef first", () => {
    const requested = glyphsFor("Hello");
    const result = subsetFont(parseSfnt(bytes), requested);

    expect(result.glyphOrder[0]).toBe(0);
    // "Hello" has a repeated l, so the distinct glyphs follow in first-use order.
    const distinct = [...new Set(requested)];
    expect(result.glyphOrder.slice(1, 1 + distinct.length)).toEqual(distinct);
  });

  it("maps each original glyph to its new id", () => {
    const requested = glyphsFor("Hello");
    const result = subsetFont(parseSfnt(bytes), requested);

    for (const [original, renumbered] of result.mapping) {
      expect(result.glyphOrder[renumbered]).toBe(original);
    }
  });

  it("produces a parseable font whose glyph count matches the subset", () => {
    const result = subsetFont(parseSfnt(bytes), glyphsFor("Hello — Ünïcödé ✓"));
    const subsetSfnt = parseSfnt(result.data);

    expect(parseMaxpNumGlyphs(subsetSfnt)).toBe(result.glyphOrder.length);
    // Long loca throughout, which is what the subsetter writes.
    expect(parseHead(subsetSfnt).indexToLocFormat).toBe(1);
  });

  it("rewrites composite component ids to the new numbering", () => {
    const eAcute = font.glyphForCodePoint("é".codePointAt(0) as number);
    const result = subsetFont(parseSfnt(bytes), [eAcute]);

    const subsetSfnt = parseSfnt(result.data);
    const numGlyphs = parseMaxpNumGlyphs(subsetSfnt);
    const loca = parseLoca(subsetSfnt, numGlyphs, parseHead(subsetSfnt).indexToLocFormat);
    const glyf = subsetSfnt.table("glyf");

    const newId = result.mapping.get(eAcute) as number;
    const data = glyf.subarray(loca[newId] as number, loca[newId + 1] as number);

    expect(isComposite(data)).toBe(true);
    for (const component of parseComponents(data)) {
      // Every component id must be inside the subset, not left pointing at the
      // original font's numbering.
      expect(component.glyphIndex).toBeLessThan(numGlyphs);
    }
  });

  it("preserves advance widths through renumbering", () => {
    const requested = glyphsFor("Hi");
    const result = subsetFont(parseSfnt(bytes), requested);

    // Read hmtx directly: a subset carries no cmap, by design, so it is output
    // rather than something Font.parse can consume.
    const subsetSfnt = parseSfnt(result.data);
    const subsetGlyphs = parseMaxpNumGlyphs(subsetSfnt);
    const subsetWidths = parseAdvanceWidths(subsetSfnt, subsetGlyphs, subsetGlyphs);

    const sourceSfnt = parseSfnt(bytes);
    const sourceWidths = parseAdvanceWidths(
      sourceSfnt,
      parseMaxpNumGlyphs(sourceSfnt),
      parseHhea(sourceSfnt).numberOfHMetrics,
    );

    for (const original of requested) {
      const renumbered = result.mapping.get(original) as number;
      expect(subsetWidths[renumbered]).toBe(sourceWidths[original]);
    }
  });

  it("shrinks the font by orders of magnitude", () => {
    const result = subsetFont(parseSfnt(bytes), glyphsFor("Hello — Ünïcödé ✓"));
    expect(result.data.length).toBeLessThan(bytes.length / 10);
  });

  it("drops hinting when asked", () => {
    const requested = glyphsFor("Hello");
    const withHinting = subsetFont(parseSfnt(bytes), requested, { keepHinting: true });
    const without = subsetFont(parseSfnt(bytes), requested, { keepHinting: false });

    expect(without.data.length).toBeLessThan(withHinting.data.length);
    expect(parseSfnt(without.data).has("fpgm")).toBe(false);
    expect(parseSfnt(withHinting.data).has("fpgm")).toBe(true);
  });

  it("omits tables an Identity-H embed does not need", () => {
    const subsetSfnt = parseSfnt(subsetFont(parseSfnt(bytes), glyphsFor("Hello")).data);
    // The PDF addresses glyphs directly, so a character map would be dead weight.
    expect(subsetSfnt.has("cmap")).toBe(false);
    expect(subsetSfnt.has("post")).toBe(false);
    expect(subsetSfnt.has("name")).toBe(false);
  });

  it("is deterministic", () => {
    const first = subsetFont(parseSfnt(bytes), glyphsFor("Hello — Ünïcödé ✓")).data;
    const second = subsetFont(parseSfnt(bytes), glyphsFor("Hello — Ünïcödé ✓")).data;
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("ignores glyph ids outside the font", () => {
    const result = subsetFont(parseSfnt(bytes), [999_999, -1]);
    expect(result.glyphOrder).toEqual([0]);
  });

  it("rejects CFF outlines with a message that says what to do", () => {
    // Forge an OTTO signature over the same tables.
    const otto = new Uint8Array(bytes);
    otto.set([0x4f, 0x54, 0x54, 0x4f], 0);
    expect(() => subsetFont(parseSfnt(otto), [1])).toThrow(/CFF outlines/);
    expect(() => subsetFont(parseSfnt(otto), [1])).toThrow(/TrueType build/);
  });
});

describe("FontSubset", () => {
  it("assigns CIDs in first-use order, starting after .notdef", () => {
    const subset = font.createSubset();
    const [h, e] = subset.useText("He");

    expect(h?.cid).toBe(1);
    expect(e?.cid).toBe(2);
    // Reusing a character reuses its CID.
    expect(subset.useCodePoint("H".codePointAt(0) as number).cid).toBe(1);
    expect(subset.glyphCount).toBe(3); // .notdef, H, e
  });

  it("iterates by code point, keeping characters outside the BMP intact", () => {
    const subset = font.createSubset();
    // U+1F600 is a surrogate pair; iterating code units would split it.
    const glyphs = subset.useText("a\u{1F600}b");
    expect(glyphs).toHaveLength(3);
    expect(glyphs[1]?.text).toBe("\u{1F600}");
  });

  it("maps unsupported characters to .notdef rather than dropping them", () => {
    const subset = font.createSubset();
    const [glyph] = subset.useText("\u{E0000}");
    expect(glyph?.cid).toBe(0);
  });

  it("builds a subset whose CIDs equal its glyph ids", () => {
    const subset = font.createSubset();
    subset.useText("Hello — Ünïcödé ✓");
    const built = subset.build();

    built.glyphOrder.forEach((_, cid) => {
      expect(built.widths.has(cid)).toBe(true);
    });
    expect(built.maxCid).toBe(built.glyphOrder.length - 1);
  });

  it("measures a string as the sum of its advances", () => {
    const subset = font.createSubset();
    const width = subset.measure("Hello");
    const perGlyph = font.advanceWidth(font.glyphForCodePoint(0x48));
    expect(width).toBeCloseTo(perGlyph * 5, 5);
  });
});
