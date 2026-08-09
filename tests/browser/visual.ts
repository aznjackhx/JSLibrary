/**
 * Playwright-facing wrapper around the visual comparison harness.
 *
 * Golden names are namespaced by browser project automatically, so
 * `expectMatchesGolden(testInfo, "invoice/page-1", png)` compares against
 * `goldens/invoice/page-1.chromium.png` on Chromium.
 */

import { expect, type TestInfo } from "@playwright/test";

import { compareToGolden, type CompareOptions, type CompareResult } from "../visual/compare.js";

export { compareToGolden, shouldUpdateGoldens } from "../visual/compare.js";
export type { CompareOptions, CompareResult } from "../visual/compare.js";

export function expectMatchesGolden(
  testInfo: TestInfo,
  name: string,
  actualPng: Buffer,
  options: CompareOptions = {},
): CompareResult {
  const result = compareToGolden(`${name}.${testInfo.project.name}`, actualPng, options);

  if (result.goldenWritten) {
    testInfo.annotations.push({ type: "golden-written", description: result.message });
    return result;
  }

  expect(result.passed, result.message).toBe(true);
  return result;
}
