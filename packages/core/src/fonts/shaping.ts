/**
 * Which scripts in a document need shaping this library does not yet do.
 *
 * Glyphs are looked up through the font's `cmap`, which is correct only where
 * one character is one glyph in one form. Arabic needs contextual joining
 * forms and required ligatures; Indic scripts need reordering and conjuncts.
 * Both live in the font's `GSUB` table, which nothing here reads yet.
 *
 * Until it does, a document in one of these scripts renders wrongly rather
 * than merely imperfectly — Arabic comes out as disconnected isolated letters.
 * This detects that and lets the caller be told, which is the difference
 * between a customer learning it from a warning and learning it from a printed
 * document.
 *
 * Detection is by character range, not by language tag. A `lang` attribute is
 * advisory and frequently absent or wrong; the characters are the fact.
 */

/**
 * Ranges that need shaping, with the name to report.
 *
 * Deliberately not every script with a `GSUB` table. Latin, Greek, Cyrillic
 * and CJK all render correctly from `cmap` alone — their optional ligatures
 * are typography, not legibility. These are the scripts where skipping `GSUB`
 * produces text a reader of that script would call wrong.
 */
const NEEDS_SHAPING: readonly { name: string; from: number; to: number }[] = [
  { name: "Arabic", from: 0x06_00, to: 0x06_ff },
  { name: "Arabic", from: 0x07_50, to: 0x07_7f },
  { name: "Arabic", from: 0x08_a0, to: 0x08_ff },
  { name: "Arabic", from: 0xfb_50, to: 0xfd_ff },
  { name: "Arabic", from: 0xfe_70, to: 0xfe_ff },
  { name: "Syriac", from: 0x07_00, to: 0x07_4f },
  { name: "Thaana", from: 0x07_80, to: 0x07_bf },
  { name: "Devanagari", from: 0x09_00, to: 0x09_7f },
  { name: "Bengali", from: 0x09_80, to: 0x09_ff },
  { name: "Gurmukhi", from: 0x0a_00, to: 0x0a_7f },
  { name: "Gujarati", from: 0x0a_80, to: 0x0a_ff },
  { name: "Oriya", from: 0x0b_00, to: 0x0b_7f },
  { name: "Tamil", from: 0x0b_80, to: 0x0b_ff },
  { name: "Telugu", from: 0x0c_00, to: 0x0c_7f },
  { name: "Kannada", from: 0x0c_80, to: 0x0c_ff },
  { name: "Malayalam", from: 0x0d_00, to: 0x0d_7f },
  { name: "Sinhala", from: 0x0d_80, to: 0x0d_ff },
  { name: "Thai", from: 0x0e_00, to: 0x0e_7f },
  { name: "Lao", from: 0x0e_80, to: 0x0e_ff },
  { name: "Tibetan", from: 0x0f_00, to: 0x0f_ff },
  { name: "Myanmar", from: 0x10_00, to: 0x10_9f },
  { name: "Khmer", from: 0x17_80, to: 0x17_ff },
];

/**
 * Scripts present in this text that this library cannot shape, in the order
 * they are first seen. Empty when everything in it renders correctly.
 */
export function scriptsNeedingShaping(text: string): string[] {
  const found: string[] = [];

  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === undefined || code < 0x05_00) continue; // Latin, Greek, Cyrillic.

    const range = NEEDS_SHAPING.find(
      (candidate) => code >= candidate.from && code <= candidate.to,
    );
    if (range && !found.includes(range.name)) found.push(range.name);
  }

  return found;
}

/** The warning shown once per render, or undefined when there is nothing to say. */
export function shapingWarning(scripts: readonly string[]): string | undefined {
  if (scripts.length === 0) return undefined;

  return (
    `This document contains ${scripts.join(", ")} text, which needs shaping ` +
    `that this library does not yet perform: characters are mapped to glyphs ` +
    `individually, so letters appear in their isolated forms and are not joined. ` +
    `The PDF is still produced, and everything else in it is correct — but text ` +
    `in ${scripts.length === 1 ? "that script" : "those scripts"} will not read ` +
    `properly. Check the output before sending it to anyone who reads it.`
  );
}
