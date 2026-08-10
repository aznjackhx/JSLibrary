/**
 * The visual regression harness is the safety net for fragmentation, so it gets
 * tested like production code: a net with a hole in it is worse than no net.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compareToGolden } from "../visual/compare.js";

/** Solid-colour PNG with an optional block of differing pixels. */
function makePng(
  width: number,
  height: number,
  colour: [number, number, number],
  differing = 0,
): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    const offset = i << 2;
    const paintDifferent = i < differing;
    png.data[offset] = paintDifferent ? 255 - colour[0] : colour[0];
    png.data[offset + 1] = paintDifferent ? 255 - colour[1] : colour[1];
    png.data[offset + 2] = paintDifferent ? 255 - colour[2] : colour[2];
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

let goldenDir: string;
let outputDir: string;

beforeEach(() => {
  goldenDir = mkdtempSync(join(tmpdir(), "goldens-"));
  outputDir = mkdtempSync(join(tmpdir(), "visual-out-"));
});

afterEach(() => {
  rmSync(goldenDir, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

describe("compareToGolden", () => {
  const black: [number, number, number] = [0, 0, 0];

  it("records a baseline when no golden exists", () => {
    const result = compareToGolden("fixture/page-1", makePng(40, 40, black), {
      goldenDir,
      outputDir,
      updateGoldens: false,
    });

    expect(result.goldenWritten).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.totalPixels).toBe(1600);
  });

  it("passes an identical render", () => {
    const png = makePng(40, 40, black);
    compareToGolden("fixture/page-1", png, { goldenDir, outputDir });

    const result = compareToGolden("fixture/page-1", png, { goldenDir, outputDir });
    expect(result.goldenWritten).toBe(false);
    expect(result.diffPixels).toBe(0);
    expect(result.passed).toBe(true);
  });

  it("fails once the differing share exceeds the tolerance", () => {
    // 1600 pixels, 0.5% tolerance = 8 pixels allowed.
    compareToGolden("fixture/page-1", makePng(40, 40, black), { goldenDir, outputDir });

    const withinTolerance = compareToGolden("fixture/page-1", makePng(40, 40, black, 8), {
      goldenDir,
      outputDir,
    });
    expect(withinTolerance.diffPixels).toBe(8);
    expect(withinTolerance.passed).toBe(true);

    const overTolerance = compareToGolden("fixture/page-1", makePng(40, 40, black, 9), {
      goldenDir,
      outputDir,
    });
    expect(overTolerance.diffPixels).toBe(9);
    expect(overTolerance.passed).toBe(false);
    expect(overTolerance.message).toContain("limit 0.500%");
  });

  it("reports a size mismatch instead of comparing mismatched buffers", () => {
    compareToGolden("fixture/page-1", makePng(40, 40, black), { goldenDir, outputDir });

    const result = compareToGolden("fixture/page-1", makePng(40, 41, black), {
      goldenDir,
      outputDir,
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain("size mismatch");
  });

  it("refreshes the golden when asked", () => {
    compareToGolden("fixture/page-1", makePng(40, 40, black), { goldenDir, outputDir });

    const refreshed = compareToGolden("fixture/page-1", makePng(40, 40, [255, 255, 255]), {
      goldenDir,
      outputDir,
      updateGoldens: true,
    });
    expect(refreshed.goldenWritten).toBe(true);

    const afterRefresh = compareToGolden("fixture/page-1", makePng(40, 40, [255, 255, 255]), {
      goldenDir,
      outputDir,
    });
    expect(afterRefresh.diffPixels).toBe(0);
  });
});
