/**
 * SFNT container: the table directory shared by TTF, OTF and WOFF.
 *
 * A font file is a directory of named tables. Parsing means locating them;
 * subsetting means rewriting a few and reassembling the directory.
 */

import { inflate } from "pako";

import { BinaryReader, BinaryWriter, tableChecksum } from "./binary.js";

/** A table located inside a font file. */
export interface SfntTable {
  readonly tag: string;
  readonly data: Uint8Array;
  readonly checksum: number;
}

export type OutlineFormat = "truetype" | "cff";

export class SfntFont {
  readonly tables: ReadonlyMap<string, SfntTable>;
  /** Sfnt version tag: `0x00010000` for TrueType, `OTTO` for CFF outlines. */
  readonly outlines: OutlineFormat;

  constructor(tables: ReadonlyMap<string, SfntTable>, outlines: OutlineFormat) {
    this.tables = tables;
    this.outlines = outlines;
  }

  has(tag: string): boolean {
    return this.tables.has(tag);
  }

  /** Table data, or throw naming the tag — a missing table is always a bug worth naming. */
  table(tag: string): Uint8Array {
    const found = this.tables.get(tag);
    if (!found) {
      throw new Error(`Font has no ${tag} table (present: ${[...this.tables.keys()].join(", ")})`);
    }
    return found.data;
  }

  reader(tag: string): BinaryReader {
    return new BinaryReader(this.table(tag));
  }
}

const TRUETYPE_VERSION = 0x0001_0000;
const OTTO = 0x4f54_544f; // 'OTTO'
const TRUE = 0x74727565; // 'true' — legacy Apple TrueType
const TTCF = 0x74746366; // 'ttcf' — TrueType collection
const WOFF = 0x774f4646; // 'wOFF'
const WOFF2 = 0x774f4632; // 'wOF2'

/**
 * Parse a font file into its table directory.
 *
 * Accepts TrueType, OpenType and WOFF 1. WOFF 2 is rejected rather than
 * silently mishandled: its tables are Brotli-compressed and its outlines are
 * stored in a transformed encoding, neither of which this reads yet. Support
 * is planned through a lazily-loaded chunk so the core budget is unaffected;
 * until then, converting the font is a one-line job for the caller.
 */
export function parseSfnt(bytes: Uint8Array): SfntFont {
  if (bytes.length < 12) {
    throw new Error(`Not a font: ${bytes.length} bytes is too short to hold a table directory`);
  }

  const signature = new BinaryReader(bytes).uint32();

  switch (signature) {
    case WOFF:
      return parseWoff(bytes);
    case WOFF2:
      throw new Error(
        "WOFF2 is not supported yet: decoding it needs a Brotli decompressor and the " +
          "reversal of WOFF2's transformed glyph encoding, neither of which this " +
          "library carries today. Supply the same font as TTF, OTF or WOFF instead — " +
          "`fonttools ttLib.woff2 decompress <file>` converts one, and most foundries " +
          "ship a TTF or OTF alongside the web build.",
      );
    case TTCF:
      throw new Error(
        "TrueType collections (.ttc) are not supported. Extract the individual font first.",
      );
    case TRUETYPE_VERSION:
    case TRUE:
    case OTTO:
      return parseTableDirectory(bytes, signature === OTTO ? "cff" : "truetype");
    default:
      throw new Error(
        `Unrecognised font signature 0x${signature.toString(16).padStart(8, "0")}`,
      );
  }
}

function parseTableDirectory(bytes: Uint8Array, outlines: OutlineFormat): SfntFont {
  const reader = new BinaryReader(bytes, 4);
  const numTables = reader.uint16();
  reader.skip(6); // searchRange, entrySelector, rangeShift — derivable, unused.

  const tables = new Map<string, SfntTable>();

  for (let i = 0; i < numTables; i += 1) {
    const tag = reader.tag();
    const checksum = reader.uint32();
    const offset = reader.uint32();
    const length = reader.uint32();

    if (offset + length > bytes.length) {
      // Some real fonts pad the final table; clamp rather than reject, but
      // never read past the buffer.
      const clamped = Math.max(0, bytes.length - offset);
      if (clamped === 0) {
        throw new Error(`Table ${tag} lies entirely outside the file`);
      }
      tables.set(tag, { tag, checksum, data: bytes.subarray(offset, offset + clamped) });
      continue;
    }

    tables.set(tag, { tag, checksum, data: bytes.subarray(offset, offset + length) });
  }

  if (tables.size === 0) {
    throw new Error("Font contains no tables");
  }

  return new SfntFont(tables, outlines);
}

/** WOFF 1: same tables, each optionally zlib-compressed. */
function parseWoff(bytes: Uint8Array): SfntFont {
  const reader = new BinaryReader(bytes, 4);
  const flavor = reader.uint32();
  reader.skip(4); // length
  const numTables = reader.uint16();
  reader.skip(2); // reserved

  const tables = new Map<string, SfntTable>();
  // Directory entries start at offset 44.
  const directory = new BinaryReader(bytes, 44);

  for (let i = 0; i < numTables; i += 1) {
    const tag = directory.tag();
    const offset = directory.uint32();
    const compressedLength = directory.uint32();
    const originalLength = directory.uint32();
    const checksum = directory.uint32();

    const stored = bytes.subarray(offset, offset + compressedLength);
    const data =
      compressedLength === originalLength ? stored : inflate(stored);

    if (data.length !== originalLength) {
      throw new Error(
        `WOFF table ${tag} decompressed to ${data.length} bytes, expected ${originalLength}`,
      );
    }

    tables.set(tag, { tag, checksum, data });
  }

  return new SfntFont(tables, flavor === OTTO ? "cff" : "truetype");
}

/**
 * Assemble a font file from tables.
 *
 * Tags are written in ASCII order, which the specification requires for the
 * directory and which also makes output deterministic. Checksums are computed
 * fresh, including the whole-file adjustment stored in `head`.
 */
export function buildSfnt(
  tables: ReadonlyMap<string, Uint8Array>,
  outlines: OutlineFormat = "truetype",
): Uint8Array {
  const tags = [...tables.keys()].sort();
  const numTables = tags.length;

  // Directory: 12-byte header plus 16 bytes per table.
  const directorySize = 12 + numTables * 16;

  const writer = new BinaryWriter(directorySize + 4096);
  writer.uint32(outlines === "cff" ? OTTO : TRUETYPE_VERSION);
  writer.uint16(numTables);

  // searchRange = largest power of two <= numTables, times 16.
  const highestPowerOfTwo = 2 ** Math.floor(Math.log2(Math.max(numTables, 1)));
  const searchRange = highestPowerOfTwo * 16;
  writer.uint16(searchRange);
  writer.uint16(Math.log2(highestPowerOfTwo));
  writer.uint16(numTables * 16 - searchRange);

  // Reserve the directory; offsets are only known once tables are laid out.
  const entries: Array<{ tag: string; offset: number; length: number; checksum: number }> = [];
  for (let i = 0; i < numTables; i += 1) {
    writer.tag("    ");
    writer.uint32(0);
    writer.uint32(0);
    writer.uint32(0);
  }

  for (const tag of tags) {
    const data = tables.get(tag) as Uint8Array;
    writer.align(4);
    entries.push({
      tag,
      offset: writer.length,
      length: data.length,
      checksum: tableChecksum(data),
    });
    writer.raw(data);
  }
  writer.align(4);

  const output = writer.toUint8Array();
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);

  entries.forEach((entry, index) => {
    const at = 12 + index * 16;
    for (let i = 0; i < 4; i += 1) view.setUint8(at + i, entry.tag.charCodeAt(i));
    view.setUint32(at + 4, entry.checksum, false);
    view.setUint32(at + 8, entry.offset, false);
    view.setUint32(at + 12, entry.length, false);
  });

  // head.checkSumAdjustment: 0xB1B0AFBA minus the checksum of the whole file,
  // computed with that field zeroed (it already is — subset() writes zero).
  const headEntry = entries.find((entry) => entry.tag === "head");
  if (headEntry) {
    const adjustment = (0xb1b0afba - tableChecksum(output)) >>> 0;
    view.setUint32(headEntry.offset + 8, adjustment, false);
  }

  return output;
}
