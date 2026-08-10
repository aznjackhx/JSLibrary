/**
 * `glyf` and `loca`: glyph outlines and where to find them.
 *
 * Only two things matter for subsetting. Where each glyph's bytes are, and
 * which other glyphs a composite glyph depends on — an "é" that references
 * "e" and an acute accent must not lose either piece.
 */

import { BinaryReader } from "./binary.js";
import type { SfntFont } from "./sfnt.js";

/** Component flags in a composite glyph description. */
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

export interface GlyphComponent {
  /** Byte offset of the component's glyph index, relative to the glyph's data. */
  readonly glyphIndexOffset: number;
  readonly glyphIndex: number;
}

/**
 * Glyph offsets from `loca`.
 *
 * The short format stores halved offsets, which is why the format flag from
 * `head` has to come along.
 */
export function parseLoca(
  font: SfntFont,
  numGlyphs: number,
  indexToLocFormat: number,
): Uint32Array {
  const data = font.table("loca");
  const reader = new BinaryReader(data);
  const offsets = new Uint32Array(numGlyphs + 1);

  if (indexToLocFormat === 0) {
    for (let i = 0; i <= numGlyphs && reader.remaining >= 2; i += 1) {
      offsets[i] = reader.uint16() * 2;
    }
  } else {
    for (let i = 0; i <= numGlyphs && reader.remaining >= 4; i += 1) {
      offsets[i] = reader.uint32();
    }
  }

  return offsets;
}

/** A glyph's raw outline bytes. Empty for glyphs with no outline, such as a space. */
export function glyphData(
  glyf: Uint8Array,
  loca: Uint32Array,
  glyphId: number,
): Uint8Array {
  const start = loca[glyphId];
  const end = loca[glyphId + 1];

  if (start === undefined || end === undefined || end <= start) {
    return new Uint8Array(0);
  }
  if (end > glyf.length) {
    // A truncated final glyph is recoverable; reading past the buffer is not.
    return glyf.subarray(start, glyf.length);
  }

  return glyf.subarray(start, end);
}

/** True when the glyph is composite — built from references to other glyphs. */
export function isComposite(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  return new BinaryReader(data).int16() < 0;
}

/**
 * Components referenced by a composite glyph, with the offset of each glyph
 * index so the subsetter can rewrite it.
 */
export function parseComponents(data: Uint8Array): GlyphComponent[] {
  if (!isComposite(data)) return [];

  const reader = new BinaryReader(data, 10); // past numberOfContours and bbox
  const components: GlyphComponent[] = [];

  for (;;) {
    if (reader.remaining < 4) break;

    const flags = reader.uint16();
    const glyphIndexOffset = reader.offset;
    const glyphIndex = reader.uint16();

    components.push({ glyphIndexOffset, glyphIndex });

    reader.skip(flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2);

    if (flags & WE_HAVE_A_SCALE) reader.skip(2);
    else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) reader.skip(4);
    else if (flags & WE_HAVE_A_TWO_BY_TWO) reader.skip(8);

    if (!(flags & MORE_COMPONENTS)) break;
  }

  return components;
}

/**
 * Expand a set of glyph ids to include everything they depend on.
 *
 * Composite glyphs reference others, and those references can nest, so this
 * walks to a fixed point. Glyph 0 (`.notdef`) is always included — a subset
 * without it is invalid.
 */
export function closeOverComponents(
  seeds: Iterable<number>,
  glyf: Uint8Array,
  loca: Uint32Array,
  numGlyphs: number,
): Set<number> {
  const included = new Set<number>([0]);
  const pending: number[] = [];

  const consider = (glyphId: number): void => {
    if (glyphId < 0 || glyphId >= numGlyphs || included.has(glyphId)) return;
    included.add(glyphId);
    pending.push(glyphId);
  };

  consider(0);
  for (const seed of seeds) consider(seed);

  while (pending.length > 0) {
    const glyphId = pending.pop() as number;
    const data = glyphData(glyf, loca, glyphId);
    for (const component of parseComponents(data)) {
      consider(component.glyphIndex);
    }
  }

  return included;
}
