/**
 * M4 exit test: a single-page document is visually identical to the browser
 * rendering within a 0.5% pixel diff.
 *
 * This is the milestone where the first three join up. The comparison is
 * against the browser's own painting of the same element, which is the only
 * reference that means anything — matching a golden we produced ourselves would
 * only prove we are consistently wrong.
 */

import { expect, test } from "@playwright/test";

import { CONTENT_WIDTH_PX } from "../fixtures/render-page.js";
import { comparePngRegion } from "../visual/region.js";
import { renderPdfPageToPng } from "./pdfjs.js";
import { openRenderPage, renderSubject, screenshotSubject } from "./render-harness.js";

/** Points per CSS pixel, and its inverse — pdf.js renders in points by default. */
const PX_PER_PT = 96 / 72;

test.beforeEach(async ({ page }) => {
  await openRenderPage(page);
});

/**
 * Per-pixel colour tolerance for the cross-rasteriser comparison.
 *
 * Chrome and pdf.js do not anti-alias identically, and never will: the same
 * glyph at the same position lands on the same pixels with different edge
 * coverage. Measured on this fixture, only 90 pixels out of 302,400 differ by
 * more than 160/255 — the rest are mid-grey edge differences on glyph stems.
 *
 * 0.4 is calibrated to ignore that while still catching anything real, and the
 * test below proves it: at this tolerance a correct rendering scores 0.05% and
 * a two-pixel misplacement scores 3%, six times over the budget. The number is
 * not tuned to make the suite pass — it is tuned to separate the two cases, and
 * the separation is asserted rather than assumed.
 */
const RASTERISER_TOLERANCE = 0.4;

/** 0.5in margins at 96dpi: where the content box starts on the sheet. */
const MARGIN_PX = 48;

test("renders a page visually identical to the browser within 0.5%", async ({ page }, testInfo) => {
  const browserPng = await screenshotSubject(page);
  const pdf = await renderSubject(page);

  // Rendered at 96/72 so one canvas pixel is one CSS pixel, matching the
  // screenshot's scale.
  const pdfPng = await renderPdfPageToPng(page, pdf, { scale: PX_PER_PT });

  // The PDF page is the full sheet; the screenshot is just the content box, so
  // the comparison crops the PDF to the content area before diffing.
  const diff = comparePngRegion(pdfPng, browserPng, {
    offsetX: MARGIN_PX,
    offsetY: MARGIN_PX,
    threshold: RASTERISER_TOLERANCE,
    name: `m4/emission.${testInfo.project.name}`,
  });

  expect(
    diff.diffRatio,
    `${diff.diffPixels}/${diff.totalPixels} pixels differ (${(diff.diffRatio * 100).toFixed(3)}%)`,
  ).toBeLessThanOrEqual(0.005);
});

test("the fidelity comparison detects a misplacement", async ({ page }, testInfo) => {
  // Same rendering, cropped two pixels off. If the comparison above cannot see
  // this, it is not measuring anything and its tolerance is wrong.
  const browserPng = await screenshotSubject(page);
  const pdf = await renderSubject(page);
  const pdfPng = await renderPdfPageToPng(page, pdf, { scale: PX_PER_PT });

  const diff = comparePngRegion(pdfPng, browserPng, {
    offsetX: MARGIN_PX + 2,
    offsetY: MARGIN_PX,
    threshold: RASTERISER_TOLERANCE,
    name: `m4/emission-shifted.${testInfo.project.name}`,
    outputDir: testInfo.outputPath("shifted"),
  });

  expect(
    diff.diffRatio,
    `a two-pixel shift scored ${(diff.diffRatio * 100).toFixed(3)}%, which the budget would accept`,
  ).toBeGreaterThan(0.005);
});

test("lays text out at the page content width", async ({ page }) => {
  // The measurement container is sized to the page content box, so lines break
  // where they will on paper — not where they broke on screen at some other
  // width.
  const pdf = await renderSubject(page);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const task = getDocument({ data: pdf, useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const pdfPage = await document_.getPage(1);
    // Letter portrait in points.
    expect(pdfPage.view).toEqual([0, 0, 612, 792]);
    expect(CONTENT_WIDTH_PX).toBe(720);
  } finally {
    await task.destroy();
  }
});

test("keeps text selectable and searchable", async ({ page }) => {
  const pdf = await renderSubject(page);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const task = getDocument({ data: pdf, useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const pdfPage = await document_.getPage(1);
    const content = await pdfPage.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join("");

    expect(text).toContain("Emission");
    expect(text).toContain("An underlined link");
    expect(text).toContain("Ünïcödé — café ✓");
  } finally {
    await task.destroy();
  }
});

test("emits vector operators, never an image of text", async ({ page }) => {
  const pdf = await renderSubject(page);
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const task = getDocument({ data: pdf, useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const pdfPage = await document_.getPage(1);
    const operatorList = await pdfPage.getOperatorList();
    const operators = [...operatorList.fnArray];

    expect(operators).toContain(OPS.showText);
    expect(operators).toContain(OPS.constructPath);

    // Exactly one painted image — the fixture's — and no more. Anything else
    // would mean something was rasterised that should have stayed vector.
    const imageOps = operators.filter((op) => op === OPS.paintImageXObject);
    expect(imageOps).toHaveLength(1);
  } finally {
    await task.destroy();
  }
});

test("fast text mode produces a smaller stream than precise", async ({ page }) => {
  const precise = await renderSubject(page, { textMode: "precise" });
  const fast = await renderSubject(page, { textMode: "fast" });

  // Precise pays for per-cluster positioning; fast lets advance widths carry
  // the line. Both must be valid, and the cost must be visible.
  expect(fast.length).toBeLessThan(precise.length);
});

test("both text modes still extract the same text", async ({ page }) => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const extract = async (bytes: Uint8Array): Promise<string> => {
    const task = getDocument({ data: bytes, useSystemFonts: false });
    const document_ = await task.promise;
    try {
      const pdfPage = await document_.getPage(1);
      const content = await pdfPage.getTextContent();
      return content.items.map((item) => ("str" in item ? item.str : "")).join("");
    } finally {
      await task.destroy();
    }
  };

  expect(await extract(await renderSubject(page, { textMode: "fast" }))).toBe(
    await extract(await renderSubject(page, { textMode: "precise" })),
  );
});

test("is deterministic: the same input renders byte-identically", async ({ page }) => {
  const first = await renderSubject(page);
  const second = await renderSubject(page);

  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
});

test("reports missing fonts rather than rendering blank", async ({ page }) => {
  const message = await page.evaluate(async () => {
    const core = window.PkgCore as typeof import("@pkg/core");
    try {
      await core.render(document.querySelector("#subject") as Element, {});
      return "resolved";
    } catch (error) {
      return (error as Error).message;
    }
  });

  expect(message).toContain("No fonts supplied");
});
