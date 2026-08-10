/**
 * M3 exit test: dump extracted geometry for a fixture page as JSON and assert
 * stability across runs.
 *
 * Stability is not a nice-to-have here. Every later milestone compares output
 * against goldens, and a measurement stage that returns slightly different
 * numbers each time makes all of that impossible.
 */

import { expect, test } from "@playwright/test";

import { stableStringify } from "../visual/json-golden.js";
import { measureSubject, openMeasurePage } from "./measure-harness.js";

type MeasuredNode = import("@pkg/core/measure/types.js").MeasuredNode;
type MeasuredElement = import("@pkg/core/measure/types.js").MeasuredElement;

test("produces identical geometry across repeated measurements", async ({ page }) => {
  await openMeasurePage(page);

  // Three times in the same page: the container is created and destroyed each
  // time, so this also proves teardown leaves no residue that shifts layout.
  const first = stableStringify(await measureSubject(page));
  const second = stableStringify(await measureSubject(page));
  const third = stableStringify(await measureSubject(page));

  expect(second).toBe(first);
  expect(third).toBe(first);
});

test("produces identical geometry across page loads", async ({ page }) => {
  await openMeasurePage(page);
  const first = stableStringify(await measureSubject(page));

  await openMeasurePage(page);
  const second = stableStringify(await measureSubject(page));

  expect(second).toBe(first);
});

test("produces identical geometry in a fresh browser context", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  try {
    const pageA = await contextA.newPage();
    await openMeasurePage(pageA);
    const first = stableStringify(await measureSubject(pageA));

    const pageB = await contextB.newPage();
    await openMeasurePage(pageB);
    const second = stableStringify(await measureSubject(pageB));

    expect(second).toBe(first);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("is unaffected by the order measurements are taken in", async ({ page }) => {
  await openMeasurePage(page);

  // Measuring at another width in between must not leave the next measurement
  // at 400 different from a clean one.
  const clean = stableStringify(await measureSubject(page, { width: 400 }));
  await measureSubject(page, { width: 250 });
  await measureSubject(page, { width: 900 });
  const afterOthers = stableStringify(await measureSubject(page, { width: 400 }));

  expect(afterOthers).toBe(clean);
});

/**
 * There is deliberately no committed geometry golden.
 *
 * Measured geometry is whatever the engine decided, and engines differ on the
 * same content: CI's Chrome snaps glyph advances to whole pixels where an older
 * build reports 9.633. A committed file would therefore encode one machine's
 * rounding policy and fail everywhere else — it would be a record of where it
 * was generated, not a statement about this code.
 *
 * What is portable is stability within an environment, asserted above, and the
 * structural invariants asserted below. Fidelity to the browser is checked
 * end-to-end in M4, by comparing against that same browser's own rendering.
 */
test("geometry is internally consistent", async ({ page }) => {
  await openMeasurePage(page);
  const measured = await measureSubject(page);

  let checkedLines = 0;

  const walk = (node: MeasuredNode, parent: MeasuredElement | undefined): void => {
    if (node.kind === "text") {
      let previousBaseline = Number.NEGATIVE_INFINITY;

      for (const line of node.lines) {
        // A line sits within the width it was laid out into.
        expect(line.rect.width).toBeLessThanOrEqual(measured.contentWidth + 1);
        expect(line.rect.height).toBeGreaterThan(0);

        // The baseline is inside its own line box.
        expect(line.baseline).toBeGreaterThan(line.rect.y);
        expect(line.baseline).toBeLessThanOrEqual(line.rect.y + line.rect.height + 0.5);

        // Lines run down the page, never back up it.
        expect(line.baseline).toBeGreaterThan(previousBaseline);
        previousBaseline = line.baseline;

        // Clusters are ordered and sit on the line they belong to.
        let previousX = Number.NEGATIVE_INFINITY;
        for (const cluster of line.clusters ?? []) {
          expect(cluster.x).toBeGreaterThanOrEqual(previousX);
          expect(cluster.x).toBeGreaterThanOrEqual(line.rect.x - 0.5);
          previousX = cluster.x;
        }

        checkedLines += 1;
      }
      return;
    }

    // A child box starts no further left than its parent's content box.
    if (parent) {
      expect(node.rect.x).toBeGreaterThanOrEqual(parent.contentRect.x - 0.5);
    }

    // The content box is inside the border box.
    expect(node.contentRect.width).toBeLessThanOrEqual(node.rect.width + 0.5);
    expect(node.contentRect.height).toBeLessThanOrEqual(node.rect.height + 0.5);

    for (const child of node.children) walk(child, node);
  };

  walk(measured.root, undefined);

  // Guard against the walk silently checking nothing.
  expect(checkedLines).toBeGreaterThan(5);
});

test("geometry dump is self-consistent", async ({ page }) => {
  await openMeasurePage(page);
  const measured = await measureSubject(page);

  // Every number that reaches the dump must be finite: a NaN would serialise as
  // null and silently corrupt every downstream comparison.
  const serialised = stableStringify(measured);
  expect(serialised).not.toContain("null");
  expect(serialised).not.toContain("NaN");
  expect(serialised).not.toContain("Infinity");
});
