/**
 * Parsed font, and the subset accumulated from the text a document actually
 * uses.
 *
 * CIDs are assigned as text is encountered rather than after the whole document
 * is walked, so a glyph's CID is known the moment it is used. The subset font is
 * then built in CID order, which keeps `CIDToGIDMap` at `/Identity`.
 */

import { parseSfnt, type SfntFont } from "./sfnt.js";
import { subsetFont, type SubsetOptions } from "./subset.js";
import {
  parseAdvanceWidths,
  parseCmap,
  parseFontName,
  parseHead,
  parseHhea,
  parseMaxpNumGlyphs,
  parseOs2,
  parsePost,
  type HeadTable,
  type HheaTable,
  type Os2Table,
  type PostTable,
} from "./tables.js";

/** PDF glyph space: 1000 units per em, regardless of the font's own scale. */
export const PDF_UNITS_PER_EM = 1000;

export class Font {
  readonly sfnt: SfntFont;
  readonly head: HeadTable;
  readonly hhea: HheaTable;
  readonly os2: Os2Table | undefined;
  readonly post: PostTable;
  readonly numGlyphs: number;
  readonly postScriptName: string;

  readonly #cmap: Map<number, number>;
  readonly #advanceWidths: Uint16Array;

  private constructor(sfnt: SfntFont) {
    this.sfnt = sfnt;
    this.head = parseHead(sfnt);
    this.hhea = parseHhea(sfnt);
    this.os2 = parseOs2(sfnt);
    this.post = parsePost(sfnt);
    this.numGlyphs = parseMaxpNumGlyphs(sfnt);
    this.postScriptName = parseFontName(sfnt);
    this.#cmap = parseCmap(sfnt);
    this.#advanceWidths = parseAdvanceWidths(sfnt, this.numGlyphs, this.hhea.numberOfHMetrics);
  }

  static parse(bytes: Uint8Array): Font {
    return new Font(parseSfnt(bytes));
  }

  get unitsPerEm(): number {
    return this.head.unitsPerEm;
  }

  /** Convert a value in font units to PDF glyph space (1000 per em). */
  toGlyphSpace(fontUnits: number): number {
    return (fontUnits * PDF_UNITS_PER_EM) / this.unitsPerEm;
  }

  /** Glyph id for a code point, or 0 (`.notdef`) when the font lacks it. */
  glyphForCodePoint(codePoint: number): number {
    return this.#cmap.get(codePoint) ?? 0;
  }

  hasGlyphFor(codePoint: number): boolean {
    return this.#cmap.has(codePoint);
  }

  /** Advance width in PDF glyph space. */
  advanceWidth(glyphId: number): number {
    return this.toGlyphSpace(this.#advanceWidths[glyphId] ?? 0);
  }

  /** Number of code points the font can render. */
  get coverage(): number {
    return this.#cmap.size;
  }

  /** Start accumulating a subset of this font. */
  createSubset(options?: SubsetOptions): FontSubset {
    return new FontSubset(this, options);
  }
}

/** One glyph's worth of encoded text. */
export interface EncodedGlyph {
  readonly cid: number;
  readonly glyphId: number;
  /** Advance width in PDF glyph space (1000 per em). */
  readonly width: number;
  /** The source text this glyph came from, for `ToUnicode`. */
  readonly text: string;
}

export interface BuiltSubset {
  /** The subset font file. */
  readonly data: Uint8Array;
  /** Original glyph id per CID, in CID order. */
  readonly glyphOrder: readonly number[];
  /** Advance width per CID, in PDF glyph space. */
  readonly widths: ReadonlyMap<number, number>;
  /** Source text per CID, for the `ToUnicode` CMap. */
  readonly toUnicode: ReadonlyMap<number, string>;
  /** Highest CID in use. */
  readonly maxCid: number;
}

export class FontSubset {
  readonly font: Font;
  readonly #options: SubsetOptions;

  /** CID -> original glyph id. Index 0 is `.notdef`, which is always present. */
  readonly #glyphOrder: number[] = [0];
  readonly #cidByGlyph = new Map<number, number>([[0, 0]]);
  readonly #textByCid = new Map<number, string>();

  constructor(font: Font, options: SubsetOptions = {}) {
    this.font = font;
    this.#options = options;
  }

  /** Number of glyphs used so far, including `.notdef`. */
  get glyphCount(): number {
    return this.#glyphOrder.length;
  }

  /**
   * Register a code point and get its CID.
   *
   * Code points the font cannot render map to CID 0, which renders as
   * `.notdef` — visible, and better than silently dropping the character.
   */
  useCodePoint(codePoint: number): EncodedGlyph {
    const glyphId = this.font.glyphForCodePoint(codePoint);
    const text = String.fromCodePoint(codePoint);

    let cid = this.#cidByGlyph.get(glyphId);
    if (cid === undefined) {
      cid = this.#glyphOrder.length;
      this.#glyphOrder.push(glyphId);
      this.#cidByGlyph.set(glyphId, cid);
    }

    // First writing wins: several code points can share a glyph, and the first
    // is the one text extraction will report.
    if (!this.#textByCid.has(cid)) this.#textByCid.set(cid, text);

    return { cid, glyphId, width: this.font.advanceWidth(glyphId), text };
  }

  /**
   * Register a whole string.
   *
   * Iterating the string yields code points, not UTF-16 code units, so
   * characters outside the BMP stay intact.
   */
  useText(text: string): EncodedGlyph[] {
    const glyphs: EncodedGlyph[] = [];
    for (const character of text) {
      glyphs.push(this.useCodePoint(character.codePointAt(0) as number));
    }
    return glyphs;
  }

  /** Total advance width of a string in PDF glyph space, registering its glyphs. */
  measure(text: string): number {
    return this.useText(text).reduce((total, glyph) => total + glyph.width, 0);
  }

  /** Build the subset font and the tables the PDF font objects need. */
  build(): BuiltSubset {
    const { data, mapping } = subsetFont(this.font.sfnt, this.#glyphOrder, this.#options);

    // Subsetting preserves the requested order, so CID n is still glyph n. Any
    // component glyphs it appended sit past the CIDs actually in use.
    const widths = new Map<number, number>();
    this.#glyphOrder.forEach((glyphId, cid) => {
      const newGlyphId = mapping.get(glyphId);
      if (newGlyphId !== cid) {
        throw new Error(
          `Subset renumbered glyph ${glyphId} to ${String(newGlyphId)}, expected CID ${cid}`,
        );
      }
      widths.set(cid, this.font.advanceWidth(glyphId));
    });

    return {
      data,
      glyphOrder: [...this.#glyphOrder],
      widths,
      toUnicode: new Map(this.#textByCid),
      maxCid: this.#glyphOrder.length - 1,
    };
  }
}
