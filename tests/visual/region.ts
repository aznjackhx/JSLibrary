/**
 * Comparing a region of one image against another.
 *
 * The browser screenshots an element; the PDF renders a whole sheet with
 * margins around it. Comparing them means cropping the sheet to where the
 * content box landed, rather than asking either side to pretend margins do not
 * exist.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const DEFAULT_OUTPUT_DIR = resolve(import.meta.dirname, "../../test-results/visual");

export interface RegionCompareOptions {
  /** Left edge of the region within the larger image, in pixels. */
  readonly offsetX: number;
  /** Top edge of the region within the larger image, in pixels. */
  readonly offsetY: number;
  /** Name used for failure artifacts. */
  readonly name: string;
  readonly threshold?: number;
  readonly outputDir?: string;
}

export interface RegionCompareResult {
  readonly diffPixels: number;
  readonly totalPixels: number;
  readonly diffRatio: number;
}

/** Crop an image to a region, returning a new PNG. */
export function cropPng(source: PNG, x: number, y: number, width: number, height: number): PNG {
  const cropped = new PNG({ width, height });

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const sourceIndex = ((y + row) * source.width + (x + column)) << 2;
      const targetIndex = (row * width + column) << 2;
      cropped.data[targetIndex] = source.data[sourceIndex] as number;
      cropped.data[targetIndex + 1] = source.data[sourceIndex + 1] as number;
      cropped.data[targetIndex + 2] = source.data[sourceIndex + 2] as number;
      cropped.data[targetIndex + 3] = source.data[sourceIndex + 3] as number;
    }
  }

  return cropped;
}

/**
 * Compare `expected` against the region of `haystack` at the given offset.
 *
 * Anti-aliasing is ignored by default. Two rasterisers will never agree on edge
 * pixels, and a comparison that fails on them tells you nothing about whether
 * the glyphs and boxes landed in the right places.
 */
export function comparePngRegion(
  haystack: Buffer,
  expected: Buffer,
  options: RegionCompareOptions,
): RegionCompareResult {
  const sheet = PNG.sync.read(haystack);
  const reference = PNG.sync.read(expected);

  const width = Math.min(reference.width, sheet.width - options.offsetX);
  const height = Math.min(reference.height, sheet.height - options.offsetY);

  if (width <= 0 || height <= 0) {
    throw new Error(
      `Region ${options.offsetX},${options.offsetY} ${reference.width}x${reference.height} ` +
        `does not fit inside ${sheet.width}x${sheet.height}`,
    );
  }

  const region = cropPng(sheet, options.offsetX, options.offsetY, width, height);
  const target =
    reference.width === width && reference.height === height
      ? reference
      : cropPng(reference, 0, 0, width, height);

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(region.data, target.data, diff.data, width, height, {
    threshold: options.threshold ?? 0.1,
  });

  const totalPixels = width * height;
  const diffRatio = totalPixels === 0 ? 1 : diffPixels / totalPixels;

  // Always write the artifacts: a passing comparison at 0.4% is worth looking
  // at too, and they cost nothing until someone opens them.
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const base = join(outputDir, options.name.replaceAll("/", "-"));
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(`${base}.pdf.png`, PNG.sync.write(region));
  writeFileSync(`${base}.browser.png`, PNG.sync.write(target));
  writeFileSync(`${base}.diff.png`, PNG.sync.write(diff));

  return { diffPixels, totalPixels, diffRatio };
}
