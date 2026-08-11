import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { GlyphSubstitutions } from "../src/fonts/gsub.js";
import { Font } from "../src/fonts/font.js";

const fontPath = (name: string): string =>
  fileURLToPath(new URL(`../../../tests/fixtures/fonts/${name}`, import.meta.url));

describe("GlyphSubstitutions", () => {
  let arabic: GlyphSubstitutions;
  let font: Font;

  beforeAll(() => {
    font = Font.parse(new Uint8Array(readFileSync(fontPath("NotoSansArabic.ttf"))));
    arabic = GlyphSubstitutions.parse(font.sfnt);
  });

  it("finds the joining forms an Arabic font offers", () => {
    expect(arabic.empty).toBe(false);
  });

  it("reads the single substitutions the joining features do carry", () => {
    // Small, and that is the finding rather than a shortfall: see the note in
    // ROADMAP.md. Noto Sans Arabic puts almost all of its joining forms in
    // lookup types this does not read yet, so what comes back here is the
    // handful that happen to be plain single substitutions.
    const summary = arabic.summary;
    expect(summary["init"]).toBeGreaterThan(0);
    expect(summary["medi"]).toBeGreaterThan(0);
  });

  it("does not yet supply beh's joining forms — the gap, asserted", () => {
    // Beh is the ordinary dual-joining letter, and its initial, medial and
    // final glyphs are exactly what a shaper must produce. They are not
    // reachable through single substitution in this font.
    //
    // Asserted rather than described, so that the day the contextual lookups
    // land this test fails and has to be rewritten as the success it becomes.
    const beh = font.glyphForCodePoint(0x06_28);
    expect(beh).toBeGreaterThan(0);

    expect(arabic.forForm(beh, "init")).toBe(beh);
    expect(arabic.forForm(beh, "medi")).toBe(beh);
    expect(arabic.forForm(beh, "fina")).toBe(beh);
  });

  it("leaves the isolated form to cmap", () => {
    // There is no `isol` feature in this font: the isolated form is what cmap
    // already returns, which is what the renderer drew before shaping existed.
    const beh = font.glyphForCodePoint(0x06_28);
    expect(arabic.forForm(beh, "isol")).toBe(beh);
  });

  it("leaves a glyph it has no substitution for alone", () => {
    const latinA = font.glyphForCodePoint(0x00_41);
    expect(arabic.forForm(latinA, "medi")).toBe(latinA);
  });

  it("reports nothing for a font with no Arabic shaping", () => {
    const serif = Font.parse(new Uint8Array(readFileSync(fontPath("DejaVuSerif.ttf"))));
    const substitutions = GlyphSubstitutions.parse(serif.sfnt);

    // It has a GSUB — Latin ligatures — but nothing under the joining
    // features, so no joining form is ever substituted.
    const a = serif.glyphForCodePoint(0x00_61);
    expect(substitutions.forForm(a, "init")).toBe(a);
  });
});
