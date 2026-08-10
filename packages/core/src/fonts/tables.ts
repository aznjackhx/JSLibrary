/**
 * Parsers for the SFNT tables the PDF pipeline needs.
 *
 * Only what embedding and subsetting actually require: metrics, glyph counts,
 * the character map, and the descriptive values a `/FontDescriptor` must carry.
 */

import { BinaryReader } from "./binary.js";
import type { SfntFont } from "./sfnt.js";

export interface HeadTable {
  readonly unitsPerEm: number;
  readonly indexToLocFormat: number;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
  readonly macStyle: number;
}

export interface HheaTable {
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly numberOfHMetrics: number;
}

export interface Os2Table {
  readonly weightClass: number;
  readonly typoAscender: number;
  readonly typoDescender: number;
  readonly capHeight: number | undefined;
  readonly xHeight: number | undefined;
  readonly fsSelection: number;
  readonly panoseSerif: boolean;
}

export interface PostTable {
  readonly italicAngle: number;
  readonly isFixedPitch: boolean;
}

export function parseHead(font: SfntFont): HeadTable {
  const reader = font.reader("head");
  reader.skip(18); // version, fontRevision, checkSumAdjustment, magicNumber, flags
  const unitsPerEm = reader.uint16();
  reader.skip(16); // created, modified
  const xMin = reader.int16();
  const yMin = reader.int16();
  const xMax = reader.int16();
  const yMax = reader.int16();
  const macStyle = reader.uint16();
  reader.skip(4); // lowestRecPPEM, fontDirectionHint
  const indexToLocFormat = reader.int16();

  if (unitsPerEm === 0) {
    throw new Error("Invalid font: head.unitsPerEm is zero");
  }

  return { unitsPerEm, indexToLocFormat, xMin, yMin, xMax, yMax, macStyle };
}

export function parseHhea(font: SfntFont): HheaTable {
  // Absolute offsets rather than a running skip: the reserved block in the
  // middle of hhea makes cumulative arithmetic easy to get quietly wrong.
  const reader = font.reader("hhea");

  reader.offset = 4;
  const ascender = reader.int16();
  const descender = reader.int16();
  const lineGap = reader.int16();

  reader.offset = 34;
  const numberOfHMetrics = reader.uint16();

  return { ascender, descender, lineGap, numberOfHMetrics };
}

export function parseMaxpNumGlyphs(font: SfntFont): number {
  const reader = font.reader("maxp");
  reader.skip(4); // version
  return reader.uint16();
}

/**
 * OS/2 field offsets. The table has grown across five versions, so every read
 * is absolute and length-checked rather than sequential.
 */
const OS2 = {
  weightClass: 4,
  panoseSerifStyle: 33,
  fsSelection: 62,
  typoAscender: 68,
  xHeight: 86,
  capHeight: 88,
} as const;

export function parseOs2(font: SfntFont): Os2Table | undefined {
  if (!font.has("OS/2")) return undefined;

  const data = font.table("OS/2");
  const reader = new BinaryReader(data);
  const version = reader.uint16();

  reader.offset = OS2.weightClass;
  const weightClass = reader.uint16();

  // PANOSE byte 1 is the serif style: 2–10 are serif designs, 11–15 sans.
  reader.offset = OS2.panoseSerifStyle;
  const serifStyle = reader.uint8();

  reader.offset = OS2.fsSelection;
  const fsSelection = reader.uint16();

  reader.offset = OS2.typoAscender;
  const typoAscender = reader.int16();
  const typoDescender = reader.int16();

  let capHeight: number | undefined;
  let xHeight: number | undefined;

  // sxHeight and sCapHeight only exist from version 2 onward.
  if (version >= 2 && data.length >= OS2.capHeight + 2) {
    reader.offset = OS2.xHeight;
    xHeight = reader.int16();
    capHeight = reader.int16();
  }

  return {
    weightClass,
    typoAscender,
    typoDescender,
    capHeight,
    xHeight,
    fsSelection,
    panoseSerif: serifStyle >= 2 && serifStyle <= 10,
  };
}

export function parsePost(font: SfntFont): PostTable {
  if (!font.has("post")) return { italicAngle: 0, isFixedPitch: false };

  const reader = font.reader("post");
  reader.skip(4); // version
  const italicAngle = reader.fixed();
  reader.skip(4); // underlinePosition, underlineThickness
  const isFixedPitch = reader.uint32() !== 0;

  return { italicAngle, isFixedPitch };
}

/**
 * Advance widths, in font units, indexed by glyph id.
 *
 * `hmtx` stores full metrics for the first `numberOfHMetrics` glyphs; every
 * glyph after that repeats the final advance width, which is how monospaced
 * tails are compressed.
 */
export function parseAdvanceWidths(
  font: SfntFont,
  numGlyphs: number,
  numberOfHMetrics: number,
): Uint16Array {
  const reader = font.reader("hmtx");
  const widths = new Uint16Array(numGlyphs);

  let lastWidth = 0;
  const metrics = Math.min(numberOfHMetrics, numGlyphs);

  for (let gid = 0; gid < metrics; gid += 1) {
    lastWidth = reader.uint16();
    widths[gid] = lastWidth;
    reader.skip(2); // leftSideBearing
  }

  // Remaining glyphs share the last advance width.
  for (let gid = metrics; gid < numGlyphs; gid += 1) widths[gid] = lastWidth;

  return widths;
}

/** Left side bearings, in font units, indexed by glyph id. */
export function parseLeftSideBearings(
  font: SfntFont,
  numGlyphs: number,
  numberOfHMetrics: number,
): Int16Array {
  const reader = font.reader("hmtx");
  const bearings = new Int16Array(numGlyphs);
  const metrics = Math.min(numberOfHMetrics, numGlyphs);

  for (let gid = 0; gid < metrics; gid += 1) {
    reader.skip(2); // advanceWidth
    bearings[gid] = reader.int16();
  }

  for (let gid = metrics; gid < numGlyphs; gid += 1) {
    if (reader.remaining < 2) break;
    bearings[gid] = reader.int16();
  }

  return bearings;
}

// --- cmap -------------------------------------------------------------------

interface CmapSubtable {
  readonly platformId: number;
  readonly encodingId: number;
  readonly offset: number;
}

/**
 * Character map: Unicode code point to glyph id.
 *
 * Subtables are ranked so a font carrying both a BMP and a full-repertoire
 * table gets the full one, which is the difference between supporting emoji
 * and silently dropping them.
 */
export function parseCmap(font: SfntFont): Map<number, number> {
  const data = font.table("cmap");
  const reader = new BinaryReader(data, 2);
  const numTables = reader.uint16();

  const subtables: CmapSubtable[] = [];
  for (let i = 0; i < numTables; i += 1) {
    subtables.push({
      platformId: reader.uint16(),
      encodingId: reader.uint16(),
      offset: reader.uint32(),
    });
  }

  const rank = (subtable: CmapSubtable): number => {
    // Windows full repertoire, then Windows BMP, then Unicode platform.
    if (subtable.platformId === 3 && subtable.encodingId === 10) return 0;
    if (subtable.platformId === 0 && subtable.encodingId >= 4) return 1;
    if (subtable.platformId === 3 && subtable.encodingId === 1) return 2;
    if (subtable.platformId === 0) return 3;
    if (subtable.platformId === 3 && subtable.encodingId === 0) return 4;
    return 5;
  };

  const ordered = [...subtables].sort((a, b) => rank(a) - rank(b));

  for (const subtable of ordered) {
    try {
      const mapping = parseCmapSubtable(data, subtable.offset);
      if (mapping.size > 0) return mapping;
    } catch {
      // A malformed subtable is not fatal while another remains to try.
      continue;
    }
  }

  throw new Error("Font has no usable Unicode cmap subtable");
}

function parseCmapSubtable(data: Uint8Array, offset: number): Map<number, number> {
  const reader = new BinaryReader(data, offset);
  const format = reader.uint16();

  switch (format) {
    case 0:
      return parseCmapFormat0(reader);
    case 4:
      return parseCmapFormat4(data, offset);
    case 6:
      return parseCmapFormat6(reader);
    case 12:
      return parseCmapFormat12(reader);
    default:
      throw new Error(`Unsupported cmap subtable format ${format}`);
  }
}

function parseCmapFormat0(reader: BinaryReader): Map<number, number> {
  reader.skip(4); // length, language
  const mapping = new Map<number, number>();
  for (let code = 0; code < 256; code += 1) {
    const gid = reader.uint8();
    if (gid !== 0) mapping.set(code, gid);
  }
  return mapping;
}

function parseCmapFormat4(data: Uint8Array, offset: number): Map<number, number> {
  const reader = new BinaryReader(data, offset + 6);
  const segCountX2 = reader.uint16();
  const segCount = segCountX2 / 2;
  reader.skip(6); // searchRange, entrySelector, rangeShift

  const endCodes = new Uint16Array(segCount);
  for (let i = 0; i < segCount; i += 1) endCodes[i] = reader.uint16();
  reader.skip(2); // reservedPad

  const startCodes = new Uint16Array(segCount);
  for (let i = 0; i < segCount; i += 1) startCodes[i] = reader.uint16();

  const idDeltas = new Int16Array(segCount);
  for (let i = 0; i < segCount; i += 1) idDeltas[i] = reader.int16();

  const idRangeOffsetsAt = reader.offset;
  const idRangeOffsets = new Uint16Array(segCount);
  for (let i = 0; i < segCount; i += 1) idRangeOffsets[i] = reader.uint16();

  const mapping = new Map<number, number>();

  for (let segment = 0; segment < segCount; segment += 1) {
    const start = startCodes[segment] as number;
    const end = endCodes[segment] as number;
    // 0xFFFF terminates the table and maps to nothing.
    if (start === 0xffff) continue;

    const delta = idDeltas[segment] as number;
    const rangeOffset = idRangeOffsets[segment] as number;

    for (let code = start; code <= end && code !== 0x1_0000; code += 1) {
      let gid: number;

      if (rangeOffset === 0) {
        gid = (code + delta) & 0xffff;
      } else {
        // The offset is relative to its own slot in idRangeOffset.
        const glyphIndexAt =
          idRangeOffsetsAt + segment * 2 + rangeOffset + (code - start) * 2;
        if (glyphIndexAt + 1 >= data.length) continue;
        const raw = new BinaryReader(data, glyphIndexAt).uint16();
        if (raw === 0) continue;
        gid = (raw + delta) & 0xffff;
      }

      if (gid !== 0) mapping.set(code, gid);
    }
  }

  return mapping;
}

function parseCmapFormat6(reader: BinaryReader): Map<number, number> {
  reader.skip(4); // length, language
  const firstCode = reader.uint16();
  const entryCount = reader.uint16();

  const mapping = new Map<number, number>();
  for (let i = 0; i < entryCount; i += 1) {
    const gid = reader.uint16();
    if (gid !== 0) mapping.set(firstCode + i, gid);
  }
  return mapping;
}

function parseCmapFormat12(reader: BinaryReader): Map<number, number> {
  reader.skip(10); // reserved, length, language
  const numGroups = reader.uint32();

  const mapping = new Map<number, number>();
  for (let i = 0; i < numGroups; i += 1) {
    const startChar = reader.uint32();
    const endChar = reader.uint32();
    const startGlyph = reader.uint32();

    // Guard against a corrupt group claiming an implausible range.
    const span = endChar - startChar;
    if (span < 0 || span > 0x10_ffff) continue;

    for (let offset = 0; offset <= span; offset += 1) {
      mapping.set(startChar + offset, startGlyph + offset);
    }
  }
  return mapping;
}

// --- name -------------------------------------------------------------------

/** Name table ids we care about. */
const NAME_FAMILY = 1;
const NAME_POSTSCRIPT = 6;

/**
 * PostScript name, falling back to the family name.
 *
 * This becomes `/BaseFont`, which must be a plain name object, so the result is
 * stripped to characters PDF names accept.
 */
export function parseFontName(font: SfntFont): string {
  const names = parseNameRecords(font);
  const chosen = names.get(NAME_POSTSCRIPT) ?? names.get(NAME_FAMILY);
  if (!chosen) return "Untitled";

  const cleaned = chosen.replaceAll(/[\s()<>[\]{}/%#]/g, "");
  return cleaned.length > 0 ? cleaned : "Untitled";
}

function parseNameRecords(font: SfntFont): Map<number, string> {
  const names = new Map<number, string>();
  if (!font.has("name")) return names;

  const data = font.table("name");
  const reader = new BinaryReader(data, 2);
  const count = reader.uint16();
  const stringOffset = reader.uint16();

  // Prefer Windows Unicode records; fall back to Macintosh Roman.
  let bestPlatform = new Map<number, number>();

  for (let i = 0; i < count; i += 1) {
    const platformId = reader.uint16();
    reader.skip(2); // encodingId
    reader.skip(2); // languageId
    const nameId = reader.uint16();
    const length = reader.uint16();
    const offset = reader.uint16();

    const at = stringOffset + offset;
    if (at + length > data.length) continue;

    const raw = data.subarray(at, at + length);
    const decoded = platformId === 3 ? decodeUtf16Be(raw) : decodeLatin1(raw);

    const priority = platformId === 3 ? 0 : 1;
    const existing = bestPlatform.get(nameId);
    if (existing === undefined || priority < existing) {
      bestPlatform.set(nameId, priority);
      names.set(nameId, decoded);
    }
  }

  return names;
}

function decodeUtf16Be(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(((bytes[i] as number) << 8) | (bytes[i + 1] as number));
  }
  return out;
}

function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}
