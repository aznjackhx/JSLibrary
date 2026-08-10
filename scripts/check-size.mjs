#!/usr/bin/env node
/**
 * Bundle-size budget.
 *
 * Core must stay at or under 60 KB gzip, excluding embedded fonts. Fonts are
 * supplied by the host page or loaded from `@font-face` sources at runtime and
 * must never be bundled, so any font binary landing in dist is also a failure.
 */

import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BUDGET_BYTES = 60 * 1024;
const FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2", ".ttc"];

/**
 * Bundles that must each fit the budget on their own.
 *
 * `index` is the real product: since M4 it reaches the whole pipeline, so its
 * number is the one that matters. The internal entries below are built so that
 * browser tests can drive modules the public API does not expose, and measuring
 * them separately keeps each subsystem's cost visible rather than buried in the
 * total. None of them appear in the package's exports map.
 */
const TARGETS = [
  { label: "@pkg/core esm", file: "packages/core/dist/index.js" },
  { label: "@pkg/core iife", file: "packages/core/dist/index.global.js" },
  { label: "@pkg/core pdf", file: "packages/core/dist/pdf.js" },
  // fonts pulls in pdf and pako, so this is the running total for everything
  // the engine has so far.
  { label: "@pkg/core fonts", file: "packages/core/dist/fonts.js" },
  { label: "@pkg/core measure", file: "packages/core/dist/measure.js" },
];

function gzipBytes(path) {
  return gzipSync(readFileSync(path), { level: 9 }).byteLength;
}

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) entries.push(...walk(path));
    else entries.push(path);
  }
  return entries;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

let failed = false;
const rows = [];

for (const { label, file } of TARGETS) {
  const path = resolve(ROOT, file);
  let bytes;
  try {
    bytes = gzipBytes(path);
  } catch {
    console.error(`✗ missing build output: ${file} — run \`pnpm build\` first`);
    failed = true;
    continue;
  }
  const over = bytes > BUDGET_BYTES;
  failed ||= over;
  rows.push({
    bundle: label,
    gzip: kb(bytes),
    budget: kb(BUDGET_BYTES),
    used: `${((bytes / BUDGET_BYTES) * 100).toFixed(1)}%`,
    status: over ? "OVER" : "ok",
  });
}

const distDir = resolve(ROOT, "packages/core/dist");
const fontFiles = walk(distDir).filter((path) =>
  FONT_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension)),
);

if (fontFiles.length > 0) {
  failed = true;
  console.error("✗ font binaries must not ship inside core:");
  for (const path of fontFiles) console.error(`    ${relative(ROOT, path)}`);
}

console.table(rows);

if (failed) {
  console.error(`✗ bundle-size budget exceeded (limit ${kb(BUDGET_BYTES)} gzip)`);
  process.exit(1);
}

console.log(`✓ within budget (${kb(BUDGET_BYTES)} gzip, fonts excluded)`);
