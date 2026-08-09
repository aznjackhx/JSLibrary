/**
 * M1 visual regression: the one-rectangle PDF, rasterised by pdf.js in a real
 * browser and compared to a committed golden.
 *
 * This is the first end-to-end exercise of the harness built in M0. Everything
 * from M4 onward compares this way, so a break here is worth catching now.
 */

import { expect, test } from "@playwright/test";

import { buildRectanglePdf, PAGE_HEIGHT, PAGE_WIDTH } from "../fixtures/rectangle.js";
import { renderPdfPageToPng } from "./pdfjs.js";
import { expectMatchesGolden } from "./visual.js";

test("renders the filled rectangle as expected", async ({ page }, testInfo) => {
  // Goldens are per browser and only the Chromium one has been generated so
  // far. Generate the others on a machine with those browsers installed
  // (`UPDATE_GOLDENS=1 pnpm test:browser`) and drop this guard — the
  // structural checks below already run everywhere.
  test.skip(
    testInfo.project.name !== "chromium",
    `No committed golden for ${testInfo.project.name} yet`,
  );

  const png = await renderPdfPageToPng(page, buildRectanglePdf());
  expectMatchesGolden(testInfo, "m1/rectangle", png);
});

test("both cross-reference styles rasterise identically", async ({ page }) => {
  // The cross-reference style is a storage detail; it must not change a single
  // painted pixel.
  const fromStream = await renderPdfPageToPng(page, buildRectanglePdf({ xref: "stream" }));
  const fromTable = await renderPdfPageToPng(page, buildRectanglePdf({ xref: "table" }));

  expect(fromTable.equals(fromStream)).toBe(true);
});

test("page canvas matches the declared MediaBox", async ({ page }) => {
  const png = await renderPdfPageToPng(page, buildRectanglePdf());

  // PNG header: width and height are big-endian 32-bit values at offsets 16/20.
  expect(png.readUInt32BE(16)).toBe(PAGE_WIDTH);
  expect(png.readUInt32BE(20)).toBe(PAGE_HEIGHT);
});
