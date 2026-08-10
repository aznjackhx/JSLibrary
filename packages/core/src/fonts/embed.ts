/**
 * Embedding a subset font into a PDF.
 *
 * The shape is a Type0 font with Identity-H encoding over a CIDFontType2
 * descendant. That combination is what makes the full Unicode range usable:
 * text is addressed by glyph, not by a 256-entry encoding table, and the
 * `ToUnicode` CMap carries the mapping back so extraction, search and
 * copy-paste still work.
 */

import { latin1 } from "../pdf/bytes.js";
import { PdfDocument } from "../pdf/document.js";
import {
  dict,
  name,
  PdfDict,
  PdfHexString,
  PdfStream,
  textString,
  type PdfRef,
  type PdfValue,
} from "../pdf/objects.js";
import type { BuiltSubset, Font } from "./font.js";

/** FontDescriptor flag bits. */
const FLAG_FIXED_PITCH = 1 << 0;
const FLAG_SERIF = 1 << 1;
const FLAG_SYMBOLIC = 1 << 2;
const FLAG_ITALIC = 1 << 6;

/** Default advance for CIDs absent from `/W`. */
const DEFAULT_WIDTH = 1000;

/** `ToUnicode` allows at most 100 entries per block. */
const BFCHAR_BLOCK = 100;

/**
 * Deterministic six-letter subset tag.
 *
 * The format requires six uppercase letters, unique per subset of a font, so
 * that two different subsets of the same face do not collide when documents are
 * merged. Deriving it from the glyph set keeps output byte-identical across
 * runs, which a random tag would not.
 */
export function subsetTag(postScriptName: string, glyphOrder: readonly number[]): string {
  let hash = 0x811c9dc5;
  const mix = (byte: number): void => {
    hash = (hash ^ byte) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };

  for (let i = 0; i < postScriptName.length; i += 1) mix(postScriptName.charCodeAt(i) & 0xff);
  for (const glyphId of glyphOrder) {
    mix(glyphId & 0xff);
    mix((glyphId >> 8) & 0xff);
  }

  let tag = "";
  let value = hash;
  for (let i = 0; i < 6; i += 1) {
    tag += String.fromCharCode(65 + (value % 26));
    value = Math.floor(value / 26);
  }
  return tag;
}

/**
 * Build the `/W` array.
 *
 * Consecutive CIDs are grouped into one `c [w1 w2 …]` run, which is how the
 * array stays small for a subset where nearly every CID has its own width.
 */
export function buildWidthArray(widths: ReadonlyMap<number, number>): PdfValue[] {
  const cids = [...widths.keys()].sort((a, b) => a - b);
  const result: PdfValue[] = [];

  let index = 0;
  while (index < cids.length) {
    const start = cids[index] as number;
    const run: number[] = [round(widths.get(start) as number)];

    let next = index + 1;
    while (next < cids.length && (cids[next] as number) === (cids[next - 1] as number) + 1) {
      run.push(round(widths.get(cids[next] as number) as number));
      next += 1;
    }

    result.push(start, run);
    index = next;
  }

  return result;
}

/** Widths are written to one decimal: finer is noise, coarser is visible. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** UTF-16BE hex, as `ToUnicode` requires. */
function utf16BeHex(text: string): string {
  let hex = "";
  for (let i = 0; i < text.length; i += 1) {
    hex += text.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  }
  return hex;
}

/**
 * Build the `ToUnicode` CMap.
 *
 * Without this, a PDF renders correctly and extracts as gibberish — the text is
 * addressed by glyph id, and nothing else records what those glyphs mean.
 */
export function buildToUnicodeCMap(toUnicode: ReadonlyMap<number, string>): Uint8Array {
  const entries = [...toUnicode.entries()]
    .filter(([cid]) => cid !== 0)
    .sort((a, b) => a[0] - b[0]);

  const lines: string[] = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
  ];

  for (let start = 0; start < entries.length; start += BFCHAR_BLOCK) {
    const block = entries.slice(start, start + BFCHAR_BLOCK);
    lines.push(`${block.length} beginbfchar`);
    for (const [cid, text] of block) {
      lines.push(`<${cid.toString(16).padStart(4, "0").toUpperCase()}> <${utf16BeHex(text)}>`);
    }
    lines.push("endbfchar");
  }

  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");

  return latin1(`${lines.join("\n")}\n`);
}

/** Descriptor flags, derived from what the font reports about itself. */
export function descriptorFlags(font: Font): number {
  // Symbolic rather than Nonsymbolic: with Identity-H the font is addressed by
  // glyph, so it is not restricted to a standard character set. The two flags
  // are mutually exclusive.
  let flags = FLAG_SYMBOLIC;

  if (font.post.isFixedPitch) flags |= FLAG_FIXED_PITCH;
  if (font.os2?.panoseSerif) flags |= FLAG_SERIF;
  // head.macStyle bit 1 is italic; italicAngle is the more reliable signal but
  // some fonts set only one of the two.
  if (font.post.italicAngle !== 0 || (font.head.macStyle & 0b10) !== 0) flags |= FLAG_ITALIC;

  return flags;
}

/**
 * Estimate the vertical stem width.
 *
 * `/StemV` is required, and TrueType does not record it, so every implementation
 * estimates. This interpolates across the weight class, which is what the value
 * mostly tracks in practice.
 */
export function estimateStemV(font: Font): number {
  const weight = font.os2?.weightClass ?? 400;
  return Math.round(10 + (220 * (Math.min(Math.max(weight, 100), 900) - 50)) / 900);
}

export interface EmbeddedFont {
  /** The Type0 font, to be registered in page resources. */
  readonly ref: PdfRef;
  readonly baseFont: string;
  /** Size of the embedded font program, uncompressed. */
  readonly fontFileLength: number;
}

/**
 * Write a subset font into the document and return the font object to reference
 * from page resources.
 */
export function embedFontSubset(
  document: PdfDocument,
  font: Font,
  subset: BuiltSubset,
): EmbeddedFont {
  const tag = subsetTag(font.postScriptName, subset.glyphOrder);
  const baseFont = `${tag}+${font.postScriptName}`;

  const fontFileRef = document.add(
    new PdfStream(
      // Length1 is the uncompressed size, which a consumer needs in order to
      // extract the font program.
      dict({ Length1: subset.data.length }),
      subset.data,
    ),
  );

  const scale = (fontUnits: number): number => Math.round(font.toGlyphSpace(fontUnits));

  const ascent = font.os2?.typoAscender ?? font.hhea.ascender;
  const descent = font.os2?.typoDescender ?? font.hhea.descender;
  const capHeight = font.os2?.capHeight ?? Math.round(ascent * 0.7);

  const descriptorRef = document.add(
    dict({
      Type: name("FontDescriptor"),
      FontName: name(baseFont),
      Flags: descriptorFlags(font),
      FontBBox: [
        scale(font.head.xMin),
        scale(font.head.yMin),
        scale(font.head.xMax),
        scale(font.head.yMax),
      ],
      ItalicAngle: Math.round(font.post.italicAngle),
      Ascent: scale(ascent),
      // Descent is negative by convention, whatever sign the font used.
      Descent: -Math.abs(scale(descent)),
      CapHeight: scale(capHeight),
      StemV: estimateStemV(font),
      FontFile2: fontFileRef,
    }),
  );

  const descendantRef = document.add(
    dict({
      Type: name("Font"),
      Subtype: name("CIDFontType2"),
      BaseFont: name(baseFont),
      CIDSystemInfo: dict({
        Registry: textString("Adobe"),
        Ordering: textString("Identity"),
        Supplement: 0,
      }),
      FontDescriptor: descriptorRef,
      DW: DEFAULT_WIDTH,
      W: buildWidthArray(subset.widths),
      // The subset is built in CID order, so CID and glyph id are the same
      // number and no mapping stream is needed.
      CIDToGIDMap: name("Identity"),
    }),
  );

  const toUnicodeRef = document.add(
    new PdfStream(new PdfDict(), buildToUnicodeCMap(subset.toUnicode)),
  );

  const ref = document.add(
    dict({
      Type: name("Font"),
      Subtype: name("Type0"),
      BaseFont: name(baseFont),
      Encoding: name("Identity-H"),
      DescendantFonts: [descendantRef],
      ToUnicode: toUnicodeRef,
    }),
  );

  return { ref, baseFont, fontFileLength: subset.data.length };
}

/**
 * Encode CIDs as a PDF string for `Tj`/`TJ`.
 *
 * Identity-H is a two-byte encoding, so each CID becomes two bytes. A hex
 * string keeps the output readable and avoids escaping every control byte.
 */
export function encodeCids(cids: readonly number[]): PdfHexString {
  const bytes = new Uint8Array(cids.length * 2);
  cids.forEach((cid, index) => {
    bytes[index * 2] = (cid >> 8) & 0xff;
    bytes[index * 2 + 1] = cid & 0xff;
  });
  return new PdfHexString(bytes);
}
