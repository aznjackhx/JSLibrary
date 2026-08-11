/**
 * M7: inline SVG becomes PDF vector paths.
 *
 * The point of this milestone is what the output is *not*: no image XObject,
 * no rasterization, no size blow-up. So the tests check both — that the drawing
 * matches the browser's own painting of it, and that it got there with path
 * operators rather than pixels.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  singleShapeHtml,
  svgHtml,
  svgTextHtml,
  SVG_PAGE_HEIGHT,
  SVG_PAGE_WIDTH,
} from "../fixtures/svg-page.js";
import { renderFontBytes } from "../fixtures/render-page.js";
import { comparePngRegion } from "../visual/region.js";
import { renderPdfPageToPng } from "./pdfjs.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

/** pdf.js renders in points; this makes one canvas pixel one CSS pixel. */
const PX_PER_PT = 96 / 72;

/**
 * Per-pixel tolerance, for the same reason as the M4 comparison: Chrome and
 * pdf.js anti-alias curve edges differently and always will. The companion
 * test below proves the tolerance still catches a real misplacement.
 */
const RASTERISER_TOLERANCE = 0.4;

async function renderHtml(page: Page, html: string, width: number, height: number): Promise<Uint8Array> {
  await page.setContent(html, { waitUntil: "load" });
  await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });

  const bytes = await page.evaluate(
    async ({ pageWidth, pageHeight, fontBytes }) => {
      const core = window.PkgCore as CoreModule;
      const pdf = await core.render(document.querySelector("#subject") as Element, {
        metadata: { creationDate: new Date("2024-01-01T00:00:00Z") },
        // A page exactly the size of the element, with no margins, so the PDF
        // page and the screenshot are the same rectangle.
        pageSize: { width: `${pageWidth}px`, height: `${pageHeight}px` },
        margins: 0,
        fonts: [{ family: "Test Mono", data: new Uint8Array(fontBytes) }],
      });
      return [...pdf];
    },
    { pageWidth: width, pageHeight: height, fontBytes: [...renderFontBytes()] },
  );

  return new Uint8Array(bytes);
}

test("draws the artwork as vector paths, matching the browser", async ({ page }, testInfo) => {
  await page.setContent(svgHtml(), { waitUntil: "load" });
  // `scale: "css"` matters: Playwright's Desktop Safari descriptor renders at
  // a device scale of 2, and the default "device" scale would hand back an
  // 800x640 screenshot to compare against a 400x320 page.
  const browserPng = await page.locator("#subject").screenshot({ scale: "css" });

  const pdf = await renderHtml(page, svgHtml(), SVG_PAGE_WIDTH, SVG_PAGE_HEIGHT);
  const pdfPng = await renderPdfPageToPng(page, pdf, { scale: PX_PER_PT });

  const diff = comparePngRegion(pdfPng, browserPng, {
    offsetX: 0,
    offsetY: 0,
    threshold: RASTERISER_TOLERANCE,
    name: `m7/svg.${testInfo.project.name}`,
  });

  expect(
    diff.diffRatio,
    `${diff.diffPixels}/${diff.totalPixels} pixels differ (${(diff.diffRatio * 100).toFixed(3)}%)`,
  ).toBeLessThanOrEqual(0.01);
});

test("the comparison detects a misplacement", async ({ page }, testInfo) => {
  // Without this the test above proves nothing: a tolerance loose enough to
  // pass anything is not measuring the drawing.
  await page.setContent(svgHtml(), { waitUntil: "load" });
  const browserPng = await page.locator("#subject").screenshot({ scale: "css" });

  const pdf = await renderHtml(page, svgHtml(), SVG_PAGE_WIDTH, SVG_PAGE_HEIGHT);
  const pdfPng = await renderPdfPageToPng(page, pdf, { scale: PX_PER_PT });

  const diff = comparePngRegion(pdfPng, browserPng, {
    offsetX: 3,
    offsetY: 0,
    threshold: RASTERISER_TOLERANCE,
    name: `m7/svg-shifted.${testInfo.project.name}`,
    outputDir: testInfo.outputPath("shifted"),
  });

  expect(diff.diffRatio).toBeGreaterThan(0.01);
});

test("embeds no image for an SVG", async ({ page }) => {
  // The whole point of the milestone. An /Image XObject here would mean the
  // drawing had been rasterized.
  const pdf = await renderHtml(page, svgHtml(), SVG_PAGE_WIDTH, SVG_PAGE_HEIGHT);
  const raw = Buffer.from(pdf).toString("latin1");

  expect(raw).not.toContain("/Subtype /Image");
});

test("stays small, as vector output should", async ({ page }) => {
  const pdf = await renderHtml(page, svgHtml(), SVG_PAGE_WIDTH, SVG_PAGE_HEIGHT);
  // A rasterized 400x320 drawing would be tens of kilobytes at least.
  expect(pdf.byteLength).toBeLessThan(8000);
});

test("is deterministic", async ({ page }) => {
  const first = await renderHtml(page, svgHtml(), SVG_PAGE_WIDTH, SVG_PAGE_HEIGHT);
  const second = await renderHtml(page, svgHtml(), SVG_PAGE_WIDTH, SVG_PAGE_HEIGHT);
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
});

test.describe("individual shapes", () => {
  /** Ink coverage of a rendered shape, as a fraction of the page. */
  async function inkRatio(page: Page, markup: string, css = ""): Promise<number> {
    const pdf = await renderHtml(page, singleShapeHtml(markup, css), 200, 200);
    const png = await renderPdfPageToPng(page, pdf, { scale: PX_PER_PT });

    const { PNG } = await import("pngjs");
    const image = PNG.sync.read(png);

    let inked = 0;
    for (let index = 0; index < image.data.length; index += 4) {
      if ((image.data[index] as number) < 200) inked += 1;
    }
    return inked / (image.width * image.height);
  }

  test("fills a shape that has a fill", async ({ page }) => {
    const ratio = await inkRatio(page, '<rect x="0" y="0" width="50" height="50" fill="black"/>');
    // A quarter of the viewBox, so a quarter of the page.
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.3);
  });

  test("draws nothing for fill:none with no stroke", async ({ page }) => {
    const ratio = await inkRatio(page, '<rect x="0" y="0" width="50" height="50" fill="none"/>');
    expect(ratio).toBe(0);
  });

  test("honours the even-odd fill rule", async ({ page }) => {
    // A square with a square hole. Under nonzero winding the hole fills in,
    // so the two rules must not produce the same amount of ink.
    const shape = (rule: string): string =>
      `<path d="M 10 10 h 80 v 80 h -80 Z M 30 30 h 40 v 40 h -40 Z" fill="black" fill-rule="${rule}"/>`;

    const evenOdd = await inkRatio(page, shape("evenodd"));
    const nonzero = await inkRatio(page, shape("nonzero"));

    expect(nonzero).toBeGreaterThan(evenOdd + 0.05);
  });

  test("scales a viewBox onto the element box", async ({ page }) => {
    // The rect covers the whole 100x100 viewBox, so it must cover the whole
    // 200x200 element — an unscaled path would cover a quarter of it.
    const ratio = await inkRatio(page, '<rect x="0" y="0" width="100" height="100" fill="black"/>');
    expect(ratio).toBeGreaterThan(0.95);
  });

  test("applies a nested transform", async ({ page }) => {
    // Translated fully off the viewBox: nothing should be drawn.
    const ratio = await inkRatio(
      page,
      '<g transform="translate(200, 0)"><rect x="0" y="0" width="50" height="50" fill="black"/></g>',
    );
    expect(ratio).toBe(0);
  });

  test("takes fill from a CSS rule as readily as an attribute", async ({ page }) => {
    // Computed style is what is read, so a stylesheet, a presentation
    // attribute and an inherited value all arrive the same way.
    const ratio = await inkRatio(
      page,
      '<rect x="0" y="0" width="50" height="50"/>',
      "rect { fill: black }",
    );
    expect(ratio).toBeGreaterThan(0.2);
  });

  test("leaves a gradient-filled shape unpainted rather than guessing", async ({ page }) => {
    // Gradients are not supported. Filling with a wrong flat colour would look
    // like a rendering bug; drawing nothing is at least honest.
    const ratio = await inkRatio(
      page,
      `<defs><linearGradient id="g"><stop offset="0" stop-color="black"/></linearGradient></defs>
       <rect x="0" y="0" width="50" height="50" fill="url(#g)"/>`,
    );
    expect(ratio).toBe(0);
  });

  test("draws nothing inside defs", async ({ page }) => {
    const ratio = await inkRatio(
      page,
      '<defs><rect x="0" y="0" width="100" height="100" fill="black"/></defs>',
    );
    expect(ratio).toBe(0);
  });

  test("skips a shape hidden by display:none", async ({ page }) => {
    const ratio = await inkRatio(
      page,
      '<rect x="0" y="0" width="100" height="100" fill="black" style="display: none"/>',
    );
    expect(ratio).toBe(0);
  });

  test("strokes a line that has no fill", async ({ page }) => {
    const ratio = await inkRatio(
      page,
      '<line x1="0" y1="50" x2="100" y2="50" stroke="black" stroke-width="10"/>',
    );
    expect(ratio).toBeGreaterThan(0.03);
  });
});

test.describe("text", () => {
  test("draws SVG text where the browser drew it", async ({ page }, testInfo) => {
    // The comparison that matters: anchoring, `tspan` styling and a rotated
    // label all have to land in the same place as the browser put them, and a
    // mirrored or misplaced label moves far more than the tolerance allows.
    await page.setContent(svgTextHtml(), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const browserPng = await page.locator("#subject").screenshot({ scale: "css" });

    const pdf = await renderHtml(page, svgTextHtml(), SVG_PAGE_WIDTH, SVG_PAGE_HEIGHT);
    const pdfPng = await renderPdfPageToPng(page, pdf, { scale: PX_PER_PT });

    const diff = comparePngRegion(pdfPng, browserPng, {
      offsetX: 0,
      offsetY: 0,
      threshold: RASTERISER_TOLERANCE,
      name: `m7/svg-text.${testInfo.project.name}`,
    });

    expect(
      diff.diffRatio,
      `${diff.diffPixels}/${diff.totalPixels} pixels differ (${(diff.diffRatio * 100).toFixed(3)}%)`,
    ).toBeLessThanOrEqual(0.02);
  });

  test("keeps SVG text as real text", async ({ page }) => {
    // A chart whose labels are outlines or pixels is a chart nobody can search,
    // copy or read with a screen reader. Every label must come back out.
    const pdf = await renderHtml(page, svgTextHtml(), SVG_PAGE_WIDTH, SVG_PAGE_HEIGHT);

    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: pdf.slice(), useSystemFonts: false });
    const document_ = await task.promise;

    try {
      const content = await (await document_.getPage(1)).getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join("")
        .replaceAll(/\s+/g, " ");

      for (const label of ["100", "0", "Q1", "Q2", "Q3", "Revenue", "GBP", "up", "14%"]) {
        expect(text, `missing ${label}`).toContain(label);
      }
    } finally {
      await task.destroy();
    }

    expect(Buffer.from(pdf).toString("latin1")).not.toContain("/Subtype /Image");
  });

  test("is deterministic", async ({ page }) => {
    const first = await renderHtml(page, svgTextHtml(), SVG_PAGE_WIDTH, SVG_PAGE_HEIGHT);
    const second = await renderHtml(page, svgTextHtml(), SVG_PAGE_WIDTH, SVG_PAGE_HEIGHT);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});
