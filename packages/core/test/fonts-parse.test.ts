import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { Font } from "../src/fonts/font.js";
import { parseSfnt } from "../src/fonts/sfnt.js";
import { parseCmap, parseHead, parseHhea, parseMaxpNumGlyphs, parseOs2 } from "../src/fonts/tables.js";

const FONT_PATH = fileURLToPath(
  new URL("../../../tests/fixtures/fonts/DejaVuSansMono.ttf", import.meta.url),
);

let bytes: Uint8Array;

beforeAll(() => {
  bytes = new Uint8Array(readFileSync(FONT_PATH));
});

describe("container parsing", () => {
  it("reads the table directory", () => {
    const sfnt = parseSfnt(bytes);
    expect(sfnt.outlines).toBe("truetype");
    for (const tag of ["head", "hhea", "maxp", "hmtx", "cmap", "glyf", "loca"]) {
      expect(sfnt.has(tag)).toBe(true);
    }
  });

  it("names the missing table when one is absent", () => {
    const sfnt = parseSfnt(bytes);
    expect(() => sfnt.table("nope")).toThrow(/has no nope table/);
  });

  it("rejects WOFF2 with an actionable message rather than mishandling it", () => {
    const woff2 = new Uint8Array(32);
    // 'wOF2'
    woff2.set([0x77, 0x4f, 0x46, 0x32], 0);
    expect(() => parseSfnt(woff2)).toThrow(/WOFF2 is not supported/);
    expect(() => parseSfnt(woff2)).toThrow(/TTF, OTF or WOFF/);
  });

  it("rejects a TrueType collection and unknown signatures", () => {
    const ttc = new Uint8Array(32);
    ttc.set([0x74, 0x74, 0x63, 0x66], 0);
    expect(() => parseSfnt(ttc)).toThrow(/collections/);

    const junk = new Uint8Array(32).fill(0x7f);
    expect(() => parseSfnt(junk)).toThrow(/Unrecognised font signature/);
  });

  it("rejects data too short to be a font", () => {
    expect(() => parseSfnt(new Uint8Array(4))).toThrow(/too short/);
  });
});

describe("metric tables", () => {
  it("reads head", () => {
    const head = parseHead(parseSfnt(bytes));
    expect(head.unitsPerEm).toBe(2048);
    expect(head.xMin).toBeLessThan(head.xMax);
    expect(head.yMin).toBeLessThan(head.yMax);
    expect([0, 1]).toContain(head.indexToLocFormat);
  });

  it("reads hhea, with numberOfHMetrics at the right offset", () => {
    const sfnt = parseSfnt(bytes);
    const hhea = parseHhea(sfnt);
    const numGlyphs = parseMaxpNumGlyphs(sfnt);

    expect(hhea.ascender).toBeGreaterThan(0);
    expect(hhea.descender).toBeLessThan(0);
    // A wrong offset here reads metricDataFormat (always 0) or garbage.
    expect(hhea.numberOfHMetrics).toBeGreaterThan(0);
    expect(hhea.numberOfHMetrics).toBeLessThanOrEqual(numGlyphs);
  });

  it("reads OS/2 with plausible values, which a bad offset would not give", () => {
    const os2 = parseOs2(parseSfnt(bytes));
    expect(os2).toBeDefined();

    const table = os2 as NonNullable<typeof os2>;
    // Weight class is 1–1000 in practice; a misaligned read gives noise.
    expect(table.weightClass).toBeGreaterThanOrEqual(100);
    expect(table.weightClass).toBeLessThanOrEqual(1000);
    expect(table.typoAscender).toBeGreaterThan(0);
    expect(table.typoDescender).toBeLessThan(0);
  });
});

describe("cmap", () => {
  it("maps the characters the exit test needs", () => {
    const cmap = parseCmap(parseSfnt(bytes));
    for (const character of "Hello — Ünïcödé ✓") {
      if (character === " ") continue;
      expect(cmap.get(character.codePointAt(0) as number)).toBeGreaterThan(0);
    }
  });

  it("maps ASCII to distinct glyphs", () => {
    const cmap = parseCmap(parseSfnt(bytes));
    const a = cmap.get(0x41) as number;
    const b = cmap.get(0x42) as number;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe("Font", () => {
  it("exposes metrics in PDF glyph space", () => {
    const font = Font.parse(bytes);

    expect(font.unitsPerEm).toBe(2048);
    // DejaVu Sans Mono is monospaced at 1233/2048 em.
    const width = font.advanceWidth(font.glyphForCodePoint(0x41));
    expect(width).toBeCloseTo((1233 * 1000) / 2048, 5);
  });

  it("is monospaced: every ASCII letter has the same advance", () => {
    const font = Font.parse(bytes);
    const widths = new Set(
      [..."abcdefgHIJKLM"].map((character) =>
        font.advanceWidth(font.glyphForCodePoint(character.codePointAt(0) as number)),
      ),
    );
    expect(widths.size).toBe(1);
  });

  it("reports missing code points as .notdef rather than throwing", () => {
    const font = Font.parse(bytes);
    // U+E0000 is unassigned, so no font maps it.
    expect(font.glyphForCodePoint(0xe_0000)).toBe(0);
    expect(font.hasGlyphFor(0xe_0000)).toBe(false);
    expect(font.hasGlyphFor(0x41)).toBe(true);
  });

  it("reads the PostScript name and strips characters a PDF name cannot hold", () => {
    const font = Font.parse(bytes);
    expect(font.postScriptName).toMatch(/^[\w-]+$/);
    expect(font.postScriptName).toContain("DejaVu");
  });
});
