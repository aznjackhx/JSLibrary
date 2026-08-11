/**
 * What a font's GSUB table actually contains.
 *
 * Written to answer one question with evidence rather than assumption: how
 * much OpenType machinery does shaping Arabic need? Run it against a font and
 * it reports the scripts, the features, and — for the features shaping
 * depends on — which lookup types they use, since that is what decides whether
 * a minimal shaper is a week's work or a rewrite.
 *
 *   node scripts/inspect-gsub.mjs tests/fixtures/fonts/NotoSansArabic.ttf
 *
 * Deliberately a script and not a library: nothing here ships, and it reads
 * only enough of the table to answer the question.
 */

import { readFileSync } from "node:fs";

const buf = readFileSync(process.argv[2]);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const u16 = (o) => dv.getUint16(o);
const u32 = (o) => dv.getUint32(o);

const numTables = u16(4);
const tables = {};
for (let i = 0; i < numTables; i++) {
  const p = 12 + i * 16;
  const tag = buf.toString("latin1", p, p + 4);
  tables[tag] = { off: u32(p + 8), len: u32(p + 12) };
}
console.log("tables:", Object.keys(tables).join(" "));
if (!tables.GSUB) { console.log("NO GSUB"); process.exit(0); }

const g = tables.GSUB.off;
const scriptListOff = g + u16(g + 4);
const featureListOff = g + u16(g + 6);
const lookupListOff = g + u16(g + 8);

// Scripts
const scriptCount = u16(scriptListOff);
const scripts = [];
for (let i = 0; i < scriptCount; i++) {
  const p = scriptListOff + 2 + i * 6;
  scripts.push(buf.toString("latin1", p, p + 4));
}
console.log("scripts:", scripts.join(" "));

// Features
const featureCount = u16(featureListOff);
const features = new Map();
for (let i = 0; i < featureCount; i++) {
  const p = featureListOff + 2 + i * 6;
  const tag = buf.toString("latin1", p, p + 4);
  const fOff = featureListOff + u16(p + 4);
  const lookupCount = u16(fOff + 2);
  const lookups = [];
  for (let j = 0; j < lookupCount; j++) lookups.push(u16(fOff + 4 + j * 2));
  features.set(tag, (features.get(tag) ?? []).concat(lookups));
}
console.log("features:", [...features.keys()].sort().join(" "));

// Lookup types for the features that matter for Arabic shaping
const lookupCount = u16(lookupListOff);
const lookupType = (index) => {
  const lOff = lookupListOff + u16(lookupListOff + 2 + index * 2);
  return u16(lOff);
};
const TYPES = { 1: "single", 2: "multiple", 3: "alternate", 4: "ligature", 5: "context", 6: "chained-context", 7: "extension", 8: "reverse-chained" };
for (const tag of ["isol", "init", "medi", "fina", "rlig", "liga", "ccmp"]) {
  const ls = features.get(tag);
  if (!ls) continue;
  const kinds = [...new Set(ls.map((i) => TYPES[lookupType(i)] ?? lookupType(i)))];
  console.log(`  ${tag}: ${ls.length} lookup(s) -> ${kinds.join(", ")}`);
}
console.log("total lookups:", lookupCount);
