/**
 * Reading `GSUB`: which glyph a character becomes in context.
 *
 * Only what shaping actually needs. `GSUB` is a large specification and a
 * general implementation is a HarfBuzz-sized project; the subset here is the
 * one that makes Arabic legible, chosen from what Noto Sans Arabic really
 * contains rather than from the specification's full surface:
 *
 * - **Lookup type 1**, single substitution — one glyph becomes one other.
 *   This is how `init`, `medi` and `fina` supply joining forms.
 * - **Lookup type 4**, ligature substitution — several glyphs become one.
 *   This is lam-alef, which is required in ordinary Arabic words.
 * - **Lookup type 7**, extension, which is only an indirection to one of the
 *   above and has to be unwrapped or the real lookup is never seen.
 *
 * Positioning is not read at all. `GPOS` decides where glyphs go, and here the
 * browser has already decided that: positions are measured per cluster and
 * pinned in the output, so the expensive half of shaping is already done.
 */

import { BinaryReader } from "./binary.js";
import type { JoiningForm } from "./joining.js";
import type { SfntFont } from "./sfnt.js";

/** Features consulted, in the order a shaper applies them. */
const JOINING_FEATURES: Record<JoiningForm, string | undefined> = {
  // There is no `isol` feature in the fonts this was built against: the
  // isolated form is what `cmap` already returns.
  isol: undefined,
  init: "init",
  medi: "medi",
  fina: "fina",
};

/** One glyph substituted for another, keyed by the glyph going in. */
type SingleMap = ReadonlyMap<number, number>;

/** A sequence of glyphs that becomes one. Longest sequences are tried first. */
interface Ligature {
  /** Glyphs after the first, which is the map key. */
  readonly rest: readonly number[];
  readonly glyph: number;
}

/**
 * The substitutions a font offers, reduced to what this can apply.
 *
 * Built once per font and cached, since parsing is the expensive part and a
 * document uses the same handful of faces throughout.
 */
export class GlyphSubstitutions {
  readonly #byFeature = new Map<string, SingleMap>();
  readonly #ligatures = new Map<number, readonly Ligature[]>();

  /** Feature tags read, with how many substitutions each carries. Diagnostic. */
  get summary(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [tag, map] of this.#byFeature) out[tag] = map.size;
    out["ligatures"] = this.#ligatures.size;
    return out;
  }

  /** True when the font offered nothing this can use. */
  get empty(): boolean {
    return this.#byFeature.size === 0 && this.#ligatures.size === 0;
  }

  /** The glyph to draw for `glyph` in the given joining form. */
  forForm(glyph: number, form: JoiningForm): number {
    const feature = JOINING_FEATURES[form];
    if (!feature) return glyph;
    return this.#byFeature.get(feature)?.get(glyph) ?? glyph;
  }

  /**
   * A ligature starting at `glyphs[index]`, if the font has one.
   *
   * Returns the glyph and how many inputs it consumed. Longer sequences win,
   * so a three-glyph ligature is preferred over a two-glyph one starting at
   * the same place.
   */
  ligatureAt(
    glyphs: readonly number[],
    index: number,
  ): { glyph: number; length: number } | undefined {
    const first = glyphs[index];
    if (first === undefined) return undefined;

    const candidates = this.#ligatures.get(first);
    if (!candidates) return undefined;

    let best: { glyph: number; length: number } | undefined;

    for (const candidate of candidates) {
      const length = candidate.rest.length + 1;
      if (best && length <= best.length) continue;

      const matches = candidate.rest.every(
        (glyph, offset) => glyphs[index + 1 + offset] === glyph,
      );
      if (matches) best = { glyph: candidate.glyph, length };
    }

    return best;
  }

  static parse(font: SfntFont): GlyphSubstitutions {
    const result = new GlyphSubstitutions();

    let table: Uint8Array;
    try {
      table = font.table("GSUB");
    } catch {
      return result; // A font with no GSUB substitutes nothing.
    }

    try {
      result.#read(table);
    } catch {
      // A malformed table is not worth failing a whole render over: the
      // document still renders, with unjoined letters, exactly as it did
      // before any of this existed.
      return new GlyphSubstitutions();
    }

    return result;
  }

  #read(table: Uint8Array): void {
    const reader = new BinaryReader(table);

    const scriptListOffset = reader.uint16At(4);
    const featureListOffset = reader.uint16At(6);
    const lookupListOffset = reader.uint16At(8);
    void scriptListOffset; // Every script here wants the same features.

    // Feature tag -> lookup indices.
    const featureCount = reader.uint16At(featureListOffset);
    const wanted = new Map<string, number[]>();

    for (let index = 0; index < featureCount; index += 1) {
      const record = featureListOffset + 2 + index * 6;
      const tag = reader.tagAt(record);
      if (tag !== "init" && tag !== "medi" && tag !== "fina" && tag !== "rlig") {
        continue;
      }

      const feature = featureListOffset + reader.uint16At(record + 4);
      const lookupCount = reader.uint16At(feature + 2);
      const indices = wanted.get(tag) ?? [];

      for (let slot = 0; slot < lookupCount; slot += 1) {
        indices.push(reader.uint16At(feature + 4 + slot * 2));
      }
      wanted.set(tag, indices);
    }

    const lookupCount = reader.uint16At(lookupListOffset);

    for (const [tag, indices] of wanted) {
      const single = new Map<number, number>();

      for (const index of indices) {
        if (index >= lookupCount) continue;
        const lookup = lookupListOffset + reader.uint16At(lookupListOffset + 2 + index * 2);
        this.#readLookup(reader, lookup, single);
      }

      if (tag !== "rlig" && single.size > 0) this.#byFeature.set(tag, single);
    }
  }

  #readLookup(reader: BinaryReader, lookup: number, single: Map<number, number>): void {
    const type = reader.uint16At(lookup);
    const subTableCount = reader.uint16At(lookup + 4);

    for (let index = 0; index < subTableCount; index += 1) {
      const subTable = lookup + reader.uint16At(lookup + 6 + index * 2);

      if (type === 7) {
        // Extension: the real type and a 32-bit offset to the real subtable.
        const realType = reader.uint16At(subTable + 2);
        const realOffset = subTable + reader.uint32At(subTable + 4);
        this.#readSubTable(reader, realType, realOffset, single);
        continue;
      }

      this.#readSubTable(reader, type, subTable, single);
    }
  }

  #readSubTable(
    reader: BinaryReader,
    type: number,
    subTable: number,
    single: Map<number, number>,
  ): void {
    if (type === 1) this.#readSingle(reader, subTable, single);
    else if (type === 2) this.#readMultiple(reader, subTable, single);
    else if (type === 4) this.#readLigatures(reader, subTable);
    // Types 3, 5 and 6 are read as nothing rather than wrongly. A contextual
    // substitution this skips leaves the glyph as it was, which is the same
    // output as before shaping existed.
  }

  /**
   * Multiple substitution: one glyph becomes a sequence.
   *
   * Only sequences of exactly one are taken. A one-glyph sequence is a single
   * substitution written differently, and fonts do use it that way under the
   * joining features. Longer sequences genuinely produce several glyphs from
   * one, which the caller here has no way to represent — a cluster maps to one
   * position — so those are left alone rather than truncated to their first
   * glyph, which would silently drop marks.
   */
  #readMultiple(reader: BinaryReader, subTable: number, single: Map<number, number>): void {
    if (reader.uint16At(subTable) !== 1) return;

    const coverage = this.#coverage(reader, subTable + reader.uint16At(subTable + 2));
    const sequenceCount = reader.uint16At(subTable + 4);

    for (let index = 0; index < sequenceCount && index < coverage.length; index += 1) {
      const glyph = coverage[index];
      if (glyph === undefined) continue;

      const sequence = subTable + reader.uint16At(subTable + 6 + index * 2);
      if (reader.uint16At(sequence) !== 1) continue;

      single.set(glyph, reader.uint16At(sequence + 2));
    }
  }

  #readSingle(reader: BinaryReader, subTable: number, single: Map<number, number>): void {
    const format = reader.uint16At(subTable);
    const coverage = this.#coverage(reader, subTable + reader.uint16At(subTable + 2));

    if (format === 1) {
      const delta = reader.int16At(subTable + 4);
      for (const glyph of coverage) single.set(glyph, (glyph + delta) & 0xff_ff);
      return;
    }

    if (format !== 2) return;
    const count = reader.uint16At(subTable + 4);
    coverage.forEach((glyph, index) => {
      if (index < count) single.set(glyph, reader.uint16At(subTable + 6 + index * 2));
    });
  }

  #readLigatures(reader: BinaryReader, subTable: number): void {
    if (reader.uint16At(subTable) !== 1) return;

    const coverage = this.#coverage(reader, subTable + reader.uint16At(subTable + 2));
    const setCount = reader.uint16At(subTable + 4);

    for (let index = 0; index < setCount && index < coverage.length; index += 1) {
      const first = coverage[index] as number;
      const set = subTable + reader.uint16At(subTable + 6 + index * 2);
      const ligatureCount = reader.uint16At(set);

      const found: Ligature[] = [...(this.#ligatures.get(first) ?? [])];

      for (let slot = 0; slot < ligatureCount; slot += 1) {
        const ligature = set + reader.uint16At(set + 2 + slot * 2);
        const glyph = reader.uint16At(ligature);
        const componentCount = reader.uint16At(ligature + 2);

        const rest: number[] = [];
        for (let component = 1; component < componentCount; component += 1) {
          rest.push(reader.uint16At(ligature + 2 + component * 2));
        }
        found.push({ rest, glyph });
      }

      this.#ligatures.set(first, found);
    }
  }

  /** The glyphs a lookup applies to, in coverage order. */
  #coverage(reader: BinaryReader, offset: number): number[] {
    const format = reader.uint16At(offset);
    const glyphs: number[] = [];

    if (format === 1) {
      const count = reader.uint16At(offset + 2);
      for (let index = 0; index < count; index += 1) {
        glyphs.push(reader.uint16At(offset + 4 + index * 2));
      }
      return glyphs;
    }

    if (format !== 2) return glyphs;

    const rangeCount = reader.uint16At(offset + 2);
    for (let index = 0; index < rangeCount; index += 1) {
      const range = offset + 4 + index * 6;
      const from = reader.uint16At(range);
      const to = reader.uint16At(range + 2);
      const startIndex = reader.uint16At(range + 4);

      for (let glyph = from; glyph <= to; glyph += 1) {
        glyphs[startIndex + (glyph - from)] = glyph;
      }
    }

    return glyphs;
  }
}
