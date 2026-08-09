/**
 * Loading the measurement bundle into a page and running it there.
 *
 * Measurement only means anything inside a real browser, so these helpers set
 * up the fixture page, wait for its embedded font to load, and expose the
 * built bundle on `window.PkgCore`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { measurePageHtml, MEASURE_WIDTH } from "../fixtures/measure-page.js";

const MEASURE_BUNDLE = resolve(
  import.meta.dirname,
  "../../packages/core/dist/measure.global.js",
);

/** The injected bundle, typed. See globals.d.ts for why the cast is needed. */
type MeasureModule = typeof import("@pkg/core/measure/index.js");

/**
 * Load the fixture page with the measurement bundle available.
 *
 * `document.fonts.ready` matters more than it looks: measuring before the
 * embedded font finishes loading produces geometry for a fallback face, and
 * every line break in the result is wrong.
 */
export async function openMeasurePage(page: Page): Promise<void> {
  await page.setContent(measurePageHtml(), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: readFileSync(MEASURE_BUNDLE, "utf8") });
}

/** Measure the fixture's subject element and return the result as data. */
export async function measureSubject(
  page: Page,
  options: { width?: number; precise?: boolean } = {},
): Promise<import("@pkg/core/measure/types.js").MeasuredDocument> {
  return page.evaluate(
    ({ width, precise }) => {
      const subject = document.querySelector("#subject");
      if (!subject) throw new Error("fixture is missing #subject");
      return (window.PkgCore as MeasureModule).measure(subject, { width, precise });
    },
    { width: options.width ?? MEASURE_WIDTH, precise: options.precise ?? true },
  );
}

type MeasuredNode = import("@pkg/core/measure/types.js").MeasuredNode;
type MeasuredElement = import("@pkg/core/measure/types.js").MeasuredElement;
type MeasuredText = import("@pkg/core/measure/types.js").MeasuredText;

/** Depth-first walk over a measured tree. */
export function* walkMeasured(node: MeasuredNode): Generator<MeasuredNode> {
  yield node;
  if (node.kind === "element") {
    for (const child of node.children) yield* walkMeasured(child);
  }
}

/** Find the measured element with a given id. */
export function findById(root: MeasuredNode, id: string): MeasuredElement | undefined {
  for (const node of walkMeasured(root)) {
    if (node.kind === "element" && node.id === id) return node;
  }
  return undefined;
}

/** Find the first element with a given tag name. */
export function findByTag(root: MeasuredNode, tag: string): MeasuredElement | undefined {
  for (const node of walkMeasured(root)) {
    if (node.kind === "element" && node.tag === tag) return node;
  }
  return undefined;
}

/** All text nodes under an element, in document order. */
export function textNodesOf(node: MeasuredNode): MeasuredText[] {
  const found: MeasuredText[] = [];
  for (const candidate of walkMeasured(node)) {
    if (candidate.kind === "text") found.push(candidate);
  }
  return found;
}

/** Concatenated text of every line under a node, one entry per line. */
export function linesOf(node: MeasuredNode): string[] {
  return textNodesOf(node).flatMap((text) => text.lines.map((line) => line.text));
}
