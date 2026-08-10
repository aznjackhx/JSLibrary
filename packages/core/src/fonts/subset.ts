/**
 * TrueType subsetting.
 *
 * Glyph ids are renumbered compactly rather than kept sparse. Keeping the
 * originals would mean a `loca` table sized for every glyph in the source font
 * — twenty-four kilobytes of offsets to reach a dozen glyphs — which defeats
 * the point. Compacting means rewriting composite glyph references, which is
 * the only real subtlety here.
 *
 * The compacted ids become the CIDs in the PDF, so `CIDToGIDMap` stays
 * `/Identity`.
 */

import { BinaryWriter } from "./binary.js";
import { closeOverComponents, glyphData, parseComponents, parseLoca } from "./glyf.js";
import { buildSfnt, type SfntFont } from "./sfnt.js";
import { parseAdvanceWidths, parseHead, parseHhea, parseLeftSideBearings, parseMaxpNumGlyphs } from "./tables.js";

/**
 * Tables copied through untouched when present.
 *
 * `cvt `, `fpgm` and `prep` carry hinting, which viewers use at small sizes.
 * `cmap`, `name` and `post` are deliberately absent: with Identity-H encoding
 * the PDF addresses glyphs directly, so they would be dead weight.
 */
const COPIED_TABLES = ["cvt ", "fpgm", "prep"] as const;

export interface SubsetResult {
  /** The subset font file. */
  readonly data: Uint8Array;
  /** Original glyph id for each new glyph id, indexed by new id. */
  readonly glyphOrder: readonly number[];
  /** New glyph id for each original glyph id that survived. */
  readonly mapping: ReadonlyMap<number, number>;
}

export interface SubsetOptions {
  /**
   * Keep hinting tables. On by default: they are small relative to outlines and
   * visibly improve rendering at small sizes.
   */
  readonly keepHinting?: boolean;
}

/**
 * Build a font containing only the requested glyphs and whatever they depend on.
 *
 * `requestedGlyphs` is an ordered list and that order is preserved: new glyph id
 * *n* is `requestedGlyphs[n]`. Callers that assign CIDs as text is encountered
 * rely on this, since it lets a CID be known at use time rather than only after
 * the whole document has been walked. Components pulled in by composite glyphs
 * are appended afterwards in ascending order.
 *
 * Glyph 0 is forced to the front — `.notdef` must be glyph 0.
 */
export function subsetFont(
  font: SfntFont,
  requestedGlyphs: readonly number[],
  options: SubsetOptions = {},
): SubsetResult {
  if (font.outlines !== "truetype") {
    throw new Error(
      "Only TrueType (glyf) outlines can be subset today; this font uses CFF outlines. " +
        "Supply a TrueType build of the font.",
    );
  }

  const head = parseHead(font);
  const hhea = parseHhea(font);
  const numGlyphs = parseMaxpNumGlyphs(font);
  const loca = parseLoca(font, numGlyphs, head.indexToLocFormat);
  const glyf = font.table("glyf");

  // Caller order first, deduplicated, with .notdef at the front.
  const glyphOrder: number[] = [0];
  const seen = new Set<number>([0]);
  for (const glyphId of requestedGlyphs) {
    if (glyphId < 0 || glyphId >= numGlyphs || seen.has(glyphId)) continue;
    seen.add(glyphId);
    glyphOrder.push(glyphId);
  }

  // Components a composite glyph depends on are appended, in ascending order so
  // the result stays deterministic regardless of discovery order.
  const closure = closeOverComponents(glyphOrder, glyf, loca, numGlyphs);
  const extra = [...closure].filter((glyphId) => !seen.has(glyphId)).sort((a, b) => a - b);
  glyphOrder.push(...extra);

  const mapping = new Map<number, number>();
  glyphOrder.forEach((originalId, newId) => mapping.set(originalId, newId));

  const advanceWidths = parseAdvanceWidths(font, numGlyphs, hhea.numberOfHMetrics);
  const leftSideBearings = parseLeftSideBearings(font, numGlyphs, hhea.numberOfHMetrics);

  const tables = new Map<string, Uint8Array>();
  const { glyfData, locaData } = buildGlyfAndLoca(glyf, loca, glyphOrder, mapping);

  tables.set("glyf", glyfData);
  tables.set("loca", locaData);
  tables.set("head", rewriteHead(font));
  tables.set("hhea", rewriteHhea(font, glyphOrder.length));
  tables.set("maxp", rewriteMaxp(font, glyphOrder.length));
  tables.set("hmtx", buildHmtx(glyphOrder, advanceWidths, leftSideBearings));

  if (options.keepHinting ?? true) {
    for (const tag of COPIED_TABLES) {
      if (font.has(tag)) tables.set(tag, font.table(tag));
    }
  }

  return { data: buildSfnt(tables, "truetype"), glyphOrder, mapping };
}

function buildGlyfAndLoca(
  glyf: Uint8Array,
  loca: Uint32Array,
  glyphOrder: readonly number[],
  mapping: ReadonlyMap<number, number>,
): { glyfData: Uint8Array; locaData: Uint8Array } {
  const body = new BinaryWriter(4096);
  const offsets: number[] = [];

  for (const originalId of glyphOrder) {
    offsets.push(body.length);

    const source = glyphData(glyf, loca, originalId);
    if (source.length === 0) continue; // A glyph with no outline, e.g. a space.

    // Copy before patching: the source is a view into the caller's font bytes.
    const copy = new Uint8Array(source);

    for (const component of parseComponents(source)) {
      const renumbered = mapping.get(component.glyphIndex);
      if (renumbered === undefined) {
        // closeOverComponents included every reachable component, so this
        // means the font references a glyph outside its own count.
        throw new Error(
          `Composite glyph ${originalId} references glyph ${component.glyphIndex}, ` +
            "which is not in the font",
        );
      }
      copy[component.glyphIndexOffset] = (renumbered >> 8) & 0xff;
      copy[component.glyphIndexOffset + 1] = renumbered & 0xff;
    }

    body.raw(copy);
    body.align(4);
  }

  offsets.push(body.length);

  // Long loca throughout: offsets are absolute, so no halving and no even-length
  // constraint on glyph data.
  const locaWriter = new BinaryWriter(offsets.length * 4);
  for (const offset of offsets) locaWriter.uint32(offset);

  return { glyfData: body.toUint8Array(), locaData: locaWriter.toUint8Array() };
}

function buildHmtx(
  glyphOrder: readonly number[],
  advanceWidths: Uint16Array,
  leftSideBearings: Int16Array,
): Uint8Array {
  const writer = new BinaryWriter(glyphOrder.length * 4);

  for (const originalId of glyphOrder) {
    writer.uint16(advanceWidths[originalId] ?? 0);
    writer.int16(leftSideBearings[originalId] ?? 0);
  }

  return writer.toUint8Array();
}

function rewriteHead(font: SfntFont): Uint8Array {
  const head = new Uint8Array(font.table("head"));
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);

  // Zeroed so buildSfnt can compute the whole-file adjustment over known bytes.
  view.setUint32(8, 0, false);
  // Long loca, matching what buildGlyfAndLoca wrote.
  view.setInt16(50, 1, false);

  return head;
}

function rewriteHhea(font: SfntFont, numGlyphs: number): Uint8Array {
  const hhea = new Uint8Array(font.table("hhea"));
  const view = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength);

  // Full metrics are written for every glyph, so numberOfHMetrics is the count.
  view.setUint16(34, numGlyphs, false);

  return hhea;
}

function rewriteMaxp(font: SfntFont, numGlyphs: number): Uint8Array {
  const maxp = new Uint8Array(font.table("maxp"));
  const view = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength);

  view.setUint16(4, numGlyphs, false);

  return maxp;
}
