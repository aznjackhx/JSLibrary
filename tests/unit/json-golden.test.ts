/**
 * The geometry golden harness gets tested like the pixel one: it is the
 * mechanism that will catch measurement regressions, so it has to be able to
 * fail.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compareJsonGolden, firstDifference, stableStringify } from "../visual/json-golden.js";

let goldenDir: string;
let outputDir: string;

beforeEach(() => {
  goldenDir = mkdtempSync(join(tmpdir(), "json-golden-"));
  outputDir = mkdtempSync(join(tmpdir(), "json-out-"));
});

afterEach(() => {
  rmSync(goldenDir, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

describe("stableStringify", () => {
  it("sorts keys so key order cannot cause a false mismatch", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("preserves array order, which is meaningful", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("sorts nested keys too", () => {
    expect(stableStringify({ x: { b: 1, a: 2 } })).toBe(stableStringify({ x: { a: 2, b: 1 } }));
  });
});

describe("firstDifference", () => {
  it("returns undefined for equal values", () => {
    expect(firstDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBeUndefined();
  });

  it("reports the path to a changed leaf", () => {
    const difference = firstDifference({ a: { b: [0, 1] } }, { a: { b: [0, 2] } });
    expect(difference?.path).toBe("$.a.b[1]");
    expect(difference?.actual).toBe(1);
    expect(difference?.expected).toBe(2);
  });

  it("reports a length change rather than walking past the end", () => {
    const difference = firstDifference([1, 2, 3], [1, 2]);
    expect(difference?.path).toBe("$.length");
  });

  it("reports a key present on one side only", () => {
    const difference = firstDifference({ a: 1, b: 2 }, { a: 1 });
    expect(difference?.path).toBe("$.b");
    expect(difference?.expected).toBeUndefined();
  });

  it("distinguishes an array from an object", () => {
    expect(firstDifference([], {})?.path).toBe("$");
  });
});

describe("compareJsonGolden", () => {
  const value = { rect: { x: 1, y: 2 }, lines: ["a", "b"] };

  it("records a baseline when no golden exists", () => {
    const result = compareJsonGolden("m3/sample", value, { goldenDir, outputDir });
    expect(result.goldenWritten).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("passes when the value is unchanged", () => {
    compareJsonGolden("m3/sample", value, { goldenDir, outputDir });

    const result = compareJsonGolden("m3/sample", value, { goldenDir, outputDir });
    expect(result.goldenWritten).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("passes when only key order changed", () => {
    compareJsonGolden("m3/sample", { a: 1, b: 2 }, { goldenDir, outputDir });

    const result = compareJsonGolden("m3/sample", { b: 2, a: 1 }, { goldenDir, outputDir });
    expect(result.passed).toBe(true);
  });

  it("fails on a changed number, naming where", () => {
    compareJsonGolden("m3/sample", value, { goldenDir, outputDir });

    const result = compareJsonGolden(
      "m3/sample",
      { ...value, rect: { x: 1, y: 3 } },
      { goldenDir, outputDir },
    );

    expect(result.passed).toBe(false);
    expect(result.message).toContain("$.rect.y");
    expect(result.message).toContain("expected: 2");
    expect(result.message).toContain("actual:   3");
  });

  it("refreshes the golden when asked", () => {
    compareJsonGolden("m3/sample", value, { goldenDir, outputDir });

    const refreshed = compareJsonGolden(
      "m3/sample",
      { ...value, lines: ["c"] },
      { goldenDir, outputDir, updateGoldens: true },
    );
    expect(refreshed.goldenWritten).toBe(true);

    const after = compareJsonGolden(
      "m3/sample",
      { ...value, lines: ["c"] },
      { goldenDir, outputDir },
    );
    expect(after.passed).toBe(true);
  });
});
