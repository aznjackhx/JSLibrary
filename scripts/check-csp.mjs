#!/usr/bin/env node
/**
 * Static guards on the built bundle.
 *
 * Hard failure: `eval` / `new Function`. Enterprises ship with a strict CSP and
 * a bundle needing either simply will not load for them.
 *
 * Warning: references to network APIs. The library must make no runtime network
 * requests, but font sources are a genuine grey area (an `@font-face` src is a
 * URL the page already fetched), so this reports rather than fails — review any
 * new hit deliberately.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const BUNDLES = [
  "packages/core/dist/index.js",
  "packages/core/dist/index.cjs",
  "packages/core/dist/index.global.js",
];

const FORBIDDEN = [
  { label: "eval(", pattern: /(?<![.\w$])eval\s*\(/g },
  { label: "new Function(", pattern: /new\s+Function\s*\(/g },
];

const SUSPICIOUS = [
  { label: "fetch(", pattern: /(?<![.\w$])fetch\s*\(/g },
  { label: "XMLHttpRequest", pattern: /XMLHttpRequest/g },
  { label: "sendBeacon", pattern: /sendBeacon/g },
  { label: "WebSocket", pattern: /(?<![.\w$])WebSocket/g },
];

let failed = false;

for (const relativePath of BUNDLES) {
  let source;
  try {
    source = readFileSync(resolve(ROOT, relativePath), "utf8");
  } catch {
    console.error(`✗ missing build output: ${relativePath} — run \`pnpm build\` first`);
    failed = true;
    continue;
  }

  for (const { label, pattern } of FORBIDDEN) {
    const hits = source.match(pattern);
    if (hits) {
      console.error(`✗ ${relativePath}: ${hits.length}x ${label} — breaks strict CSP`);
      failed = true;
    }
  }

  for (const { label, pattern } of SUSPICIOUS) {
    const hits = source.match(pattern);
    if (hits) {
      console.warn(`⚠ ${relativePath}: ${hits.length}x ${label} — confirm no runtime request`);
    }
  }
}

if (failed) process.exit(1);

console.log("✓ no eval / new Function in built bundles");
