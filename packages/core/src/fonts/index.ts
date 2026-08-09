/**
 * Font pipeline — internal.
 *
 * Parse, subset, embed. Hand-rolled rather than built on fontkit: fontkit
 * bundles to 146 KB gzip, which is more than twice this library's entire budget
 * for everything.
 *
 * TrueType (`glyf`) outlines are supported. CFF outlines and WOFF2 are rejected
 * with an explicit message rather than mishandled.
 */

export { BinaryReader, BinaryWriter, tableChecksum } from "./binary.js";
export {
  buildToUnicodeCMap,
  buildWidthArray,
  descriptorFlags,
  embedFontSubset,
  encodeCids,
  estimateStemV,
  subsetTag,
} from "./embed.js";
export type { EmbeddedFont } from "./embed.js";
export { Font, FontSubset, PDF_UNITS_PER_EM } from "./font.js";
export type { BuiltSubset, EncodedGlyph } from "./font.js";
export { closeOverComponents, glyphData, isComposite, parseComponents, parseLoca } from "./glyf.js";
export { FontRegistry, orderWeights, parseFontFamilyList } from "./resolve.js";
export type { FontRequest, FontSource, FontStyle } from "./resolve.js";
export { buildSfnt, parseSfnt, SfntFont } from "./sfnt.js";
export type { OutlineFormat, SfntTable } from "./sfnt.js";
export { subsetFont } from "./subset.js";
export type { SubsetOptions, SubsetResult } from "./subset.js";
export {
  parseAdvanceWidths,
  parseCmap,
  parseFontName,
  parseHead,
  parseHhea,
  parseMaxpNumGlyphs,
  parseOs2,
  parsePost,
} from "./tables.js";
export type { HeadTable, HheaTable, Os2Table, PostTable } from "./tables.js";
