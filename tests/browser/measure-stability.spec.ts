/**
 * M3 exit test: dump extracted geometry for a fixture page as JSON and assert
 * stability across runs.
 *
 * Stability is not a nice-to-have here. Every later milestone compares output
 * against goldens, and a measurement stage that returns slightly different
 * numbers each time makes all of that impossible.
 */

import { expect, test } from "@playwright/test";

import { compareJsonGolden, stableStringify } from "../visual/json-golden.js";
import { measureSubject, openMeasurePage } from "./measure-harness.js";

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

test("matches the committed geometry golden", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    `No committed geometry golden for ${testInfo.project.name} yet`,
  );

  await openMeasurePage(page);
  const measured = await measureSubject(page);

  const result = compareJsonGolden(`m3/geometry.${testInfo.project.name}`, measured);

  if (result.goldenWritten) {
    expect(
      Boolean(process.env["CI"]),
      `${result.message} — generate with UPDATE_GOLDENS=1 and commit it.`,
    ).toBe(false);
    testInfo.annotations.push({ type: "golden-written", description: result.message });
    return;
  }

  expect(result.passed, result.message).toBe(true);
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
