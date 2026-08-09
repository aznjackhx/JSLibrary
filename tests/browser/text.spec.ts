/**
 * M2 visual regression: text set in an embedded subset font, rasterised by
 * pdf.js in a real browser.
 *
 * The structural tests prove the bytes are right; this proves the glyphs
 * actually paint. A subset with correct metrics and broken outlines passes
 * every structural check and renders as blanks.
 */

import { expect, test } from "@playwright/test";

import { buildTextPdf, SAMPLE_TEXT } from "../fixtures/text.js";
import { renderPdfPageToPng } from "./pdfjs.js";
import { expectMatchesGolden } from "./visual.js";

test("renders embedded subset text", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    `No committed golden for ${testInfo.project.name} yet`,
  );

  const png = await renderPdfPageToPng(page, buildTextPdf());
  expectMatchesGolden(testInfo, "m2/text", png);
});

test("paints actual glyphs rather than blank space", async ({ page }) => {
  // A subset with correct metrics but broken outlines renders as an empty page,
  // which every structural assertion would happily accept.
  const withText = await renderPdfPageToPng(page, buildTextPdf());
  const empty = await renderPdfPageToPng(page, buildTextPdf({ text: " " }));

  expect(withText.equals(empty)).toBe(false);
});

test("extracts the sample text in the browser", async ({ page }) => {
  await page.goto("about:blank");

  const extracted = await page.evaluate(
    async ({ bytes, pdfSource, workerSource }) => {
      const toBlobUrl = (source: string): string =>
        URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

      const pdfjs = (await import(/* @vite-ignore */ toBlobUrl(pdfSource))) as typeof import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = toBlobUrl(workerSource);

      const document_ = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
      const pdfPage = await document_.getPage(1);
      const content = await pdfPage.getTextContent();

      return content.items.map((item) => ("str" in item ? item.str : "")).join("");
    },
    {
      bytes: [...buildTextPdf()],
      pdfSource: (await import("node:fs")).readFileSync(
        (await import("node:module"))
          .createRequire(import.meta.url)
          .resolve("pdfjs-dist/legacy/build/pdf.min.mjs"),
        "utf8",
      ),
      workerSource: (await import("node:fs")).readFileSync(
        (await import("node:module"))
          .createRequire(import.meta.url)
          .resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
        "utf8",
      ),
    },
  );

  expect(extracted).toBe(SAMPLE_TEXT);
});
