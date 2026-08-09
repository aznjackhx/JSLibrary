/**
 * Golden comparison for structured data.
 *
 * The pixel harness answers "does it still look the same"; this answers "is the
 * geometry we extracted still the same", which is the cheaper and more precise
 * question when the thing under test is a data structure.
 *
 * On mismatch it reports the first differing path rather than dumping two large
 * JSON blobs side by side, because a measured tree is thousands of lines and a
 * raw diff is unreadable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const DEFAULT_GOLDEN_DIR = resolve(import.meta.dirname, "../browser/goldens");
const DEFAULT_OUTPUT_DIR = resolve(import.meta.dirname, "../../test-results/json");

export interface JsonGoldenOptions {
  readonly goldenDir?: string;
  readonly outputDir?: string;
  readonly updateGoldens?: boolean;
}

export interface JsonGoldenResult {
  readonly name: string;
  readonly passed: boolean;
  readonly goldenWritten: boolean;
  readonly message: string;
}

export function shouldUpdateGoldens(): boolean {
  return process.env["UPDATE_GOLDENS"] === "1";
}

/** Stable JSON: keys sorted, so key order can never cause a false mismatch. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, sortedReplacer, 2)}\n`;
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = (value as Record<string, unknown>)[key];
  }
  return sorted;
}

/** First path at which two values differ, or undefined when they match. */
export function firstDifference(
  actual: unknown,
  expected: unknown,
  path = "$",
): { path: string; actual: unknown; expected: unknown } | undefined {
  if (Object.is(actual, expected)) return undefined;

  const bothObjects =
    typeof actual === "object" && actual !== null && typeof expected === "object" && expected !== null;

  if (!bothObjects) return { path, actual, expected };

  if (Array.isArray(actual) !== Array.isArray(expected)) {
    return { path, actual, expected };
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      return { path: `${path}.length`, actual: actual.length, expected: expected.length };
    }
    for (let i = 0; i < actual.length; i += 1) {
      const difference = firstDifference(actual[i], expected[i], `${path}[${i}]`);
      if (difference) return difference;
    }
    return undefined;
  }

  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(actualRecord), ...Object.keys(expectedRecord)])].sort();

  for (const key of keys) {
    const difference = firstDifference(actualRecord[key], expectedRecord[key], `${path}.${key}`);
    if (difference) return difference;
  }

  return undefined;
}

/**
 * Compare a value against its committed golden.
 *
 * A missing golden is recorded rather than failed, so a new fixture gets a
 * baseline on first run. The Playwright wrapper turns that into a failure in
 * CI, where a missing golden means it was never committed.
 */
export function compareJsonGolden(
  name: string,
  actual: unknown,
  options: JsonGoldenOptions = {},
): JsonGoldenResult {
  const goldenDir = options.goldenDir ?? DEFAULT_GOLDEN_DIR;
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const updateGoldens = options.updateGoldens ?? shouldUpdateGoldens();

  const goldenPath = join(goldenDir, `${name}.json`);
  const serialised = stableStringify(actual);

  if (!existsSync(goldenPath) || updateGoldens) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, serialised);
    return {
      name,
      passed: true,
      goldenWritten: true,
      message: `${name}: golden written (${serialised.length} bytes)`,
    };
  }

  const expected = JSON.parse(readFileSync(goldenPath, "utf8")) as unknown;
  const difference = firstDifference(JSON.parse(serialised) as unknown, expected);

  if (!difference) {
    return { name, passed: true, goldenWritten: false, message: `${name}: matches golden` };
  }

  mkdirSync(dirname(join(outputDir, name)), { recursive: true });
  writeFileSync(join(outputDir, `${name.replaceAll("/", "-")}.actual.json`), serialised);

  return {
    name,
    passed: false,
    goldenWritten: false,
    message:
      `${name}: differs from golden at ${difference.path}\n` +
      `  expected: ${JSON.stringify(difference.expected)}\n` +
      `  actual:   ${JSON.stringify(difference.actual)}`,
  };
}
