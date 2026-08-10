/**
 * Visual regression comparison — pure, no test-runner dependency.
 *
 * From M1 onward the flow is: render a PDF page to PNG with pdf.js inside the
 * browser, hand the bytes here, compare against a committed golden. This is the
 * primary safety net — fragmentation regressions are invisible to unit tests.
 *
 * Goldens are stored per browser project, because Chromium, Firefox and WebKit
 * do not rasterise identically; a single shared golden would either be flaky or
 * force a tolerance so loose it catches nothing.
 *
 * Refresh goldens with `UPDATE_GOLDENS=1 pnpm test:browser`. Review the diff
 * before committing: an updated golden asserts the new rendering is correct.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const DEFAULT_GOLDEN_DIR = resolve(import.meta.dirname, "../browser/goldens");
const DEFAULT_OUTPUT_DIR = resolve(import.meta.dirname, "../../test-results/visual");

/** 0.5% differing pixels — the tolerance the brief sets for "visually identical". */
export const DEFAULT_MAX_DIFF_RATIO = 0.005;

export interface CompareOptions {
  /** Per-pixel colour distance before a pixel counts as different. 0–1. */
  readonly threshold?: number;
  /** Share of differing pixels tolerated before the comparison fails. */
  readonly maxDiffRatio?: number;
  /** Overridden by tests; defaults to `tests/browser/goldens`. */
  readonly goldenDir?: string;
  /** Where failure artifacts are written. */
  readonly outputDir?: string;
  /** Write the golden instead of comparing. Defaults to `UPDATE_GOLDENS=1`. */
  readonly updateGoldens?: boolean;
}

export interface CompareResult {
  readonly name: string;
  readonly diffPixels: number;
  readonly totalPixels: number;
  readonly diffRatio: number;
  readonly maxDiffRatio: number;
  readonly passed: boolean;
  /** True when the golden was created or refreshed instead of compared. */
  readonly goldenWritten: boolean;
  readonly message: string;
}

function writeFileAt(path: string, data: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

export function shouldUpdateGoldens(): boolean {
  return process.env["UPDATE_GOLDENS"] === "1";
}

/**
 * Compare a PNG against its golden.
 *
 * `name` identifies the fixture, page and browser, e.g. `invoice/page-1.chromium`.
 * A missing golden is written rather than failed, so the first run of a new
 * fixture records a baseline; CI runs with goldens committed, so a missing one
 * there is caught by review of the resulting diff.
 */
export function compareToGolden(
  name: string,
  actualPng: Buffer,
  options: CompareOptions = {},
): CompareResult {
  const threshold = options.threshold ?? 0.1;
  const maxDiffRatio = options.maxDiffRatio ?? DEFAULT_MAX_DIFF_RATIO;
  const goldenDir = options.goldenDir ?? DEFAULT_GOLDEN_DIR;
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const updateGoldens = options.updateGoldens ?? shouldUpdateGoldens();

  const goldenPath = join(goldenDir, `${name}.png`);

  if (!existsSync(goldenPath) || updateGoldens) {
    writeFileAt(goldenPath, actualPng);
    const written = PNG.sync.read(actualPng);
    return {
      name,
      diffPixels: 0,
      totalPixels: written.width * written.height,
      diffRatio: 0,
      maxDiffRatio,
      passed: true,
      goldenWritten: true,
      message: `${name}: golden written (${written.width}x${written.height})`,
    };
  }

  const golden = PNG.sync.read(readFileSync(goldenPath));
  const actual = PNG.sync.read(actualPng);

  if (golden.width !== actual.width || golden.height !== actual.height) {
    writeFileAt(join(outputDir, `${name}.actual.png`), actualPng);
    return {
      name,
      diffPixels: Number.NaN,
      totalPixels: golden.width * golden.height,
      diffRatio: 1,
      maxDiffRatio,
      passed: false,
      goldenWritten: false,
      message:
        `${name}: size mismatch — golden is ${golden.width}x${golden.height}, ` +
        `actual is ${actual.width}x${actual.height}`,
    };
  }

  const diff = new PNG({ width: golden.width, height: golden.height });
  const diffPixels = pixelmatch(
    golden.data,
    actual.data,
    diff.data,
    golden.width,
    golden.height,
    { threshold },
  );

  const totalPixels = golden.width * golden.height;
  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const passed = diffRatio <= maxDiffRatio;

  if (!passed) {
    // Write all three so a CI failure is diagnosable from artifacts alone.
    writeFileAt(join(outputDir, `${name}.actual.png`), actualPng);
    writeFileAt(join(outputDir, `${name}.expected.png`), PNG.sync.write(golden));
    writeFileAt(join(outputDir, `${name}.diff.png`), PNG.sync.write(diff));
  }

  return {
    name,
    diffPixels,
    totalPixels,
    diffRatio,
    maxDiffRatio,
    passed,
    goldenWritten: false,
    message:
      `${name}: ${diffPixels}/${totalPixels} pixels differ ` +
      `(${(diffRatio * 100).toFixed(3)}%, limit ${(maxDiffRatio * 100).toFixed(3)}%)`,
  };
}
