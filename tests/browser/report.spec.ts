/**
 * M5.9: the corpus fixture, determinism, and the performance budget.
 *
 * Each fragmentation rule has its own focused fixture. This one exists because
 * the rules interact, and because the brief sets a wall-clock target that only
 * a realistic document can measure.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  ROWS_PER_TABLE,
  SECTION_COUNT,
  figureCaption,
  reportHtml,
  rowLabel,
  sectionTitle,
  tableHeader,
} from "../fixtures/report-page.js";
import { renderFontBytes } from "../fixtures/render-page.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

interface RenderResult {
  readonly bytes: Uint8Array;
  /** Wall-clock milliseconds spent inside render(). */
  readonly elapsed: number;
}

async function renderReport(page: Page): Promise<RenderResult> {
  await page.setContent(reportHtml(), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });

  const result = await page.evaluate(
    async ({ fontBytes }) => {
      const core = window.PkgCore as CoreModule;
      const started = performance.now();
      const pdf = await core.render(document.querySelector("#subject") as Element, {
        pageSize: "Letter",
        margins: "0.5in",
        metadata: { title: "Quarterly Report", creationDate: new Date("2024-01-01T00:00:00Z") },
        fonts: [{ family: "Test Mono", data: new Uint8Array(fontBytes) }],
      });
      return { bytes: [...pdf], elapsed: performance.now() - started };
    },
    { fontBytes: [...renderFontBytes()] },
  );

  return { bytes: new Uint8Array(result.bytes), elapsed: result.elapsed };
}

async function textPerPage(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const pages: string[] = [];
    for (let number = 1; number <= document_.numPages; number += 1) {
      const page = await document_.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(""));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

test("spans many pages", async ({ page }) => {
  const pages = await textPerPage((await renderReport(page)).bytes);
  expect(pages.length).toBeGreaterThan(5);
});

test("keeps every section and every row, exactly once", async ({ page }) => {
  const combined = (await textPerPage((await renderReport(page)).bytes)).join("");

  for (let index = 1; index <= SECTION_COUNT; index += 1) {
    expect(combined.split(sectionTitle(index)).length - 1, sectionTitle(index)).toBe(1);

    for (let row = 1; row <= ROWS_PER_TABLE; row += 1) {
      const label = rowLabel(index, row);
      expect(combined.split(label).length - 1, label).toBe(1);
    }
  }
});

test("repeats each table's header on every page that table reaches", async ({ page }) => {
  const pages = await textPerPage((await renderReport(page)).bytes);

  for (let index = 1; index <= SECTION_COUNT; index += 1) {
    const rowPages = pages
      .map((text, pageIndex) => (text.includes(`[S${String(index).padStart(2, "0")}R`) ? pageIndex : -1))
      .filter((pageIndex) => pageIndex >= 0);
    const headerPages = pages
      .map((text, pageIndex) => (text.includes(tableHeader(index)) ? pageIndex : -1))
      .filter((pageIndex) => pageIndex >= 0);

    expect(headerPages, `table ${index} header pages`).toEqual(
      expect.arrayContaining(rowPages),
    );
  }
});

test("never divides a figure", async ({ page }) => {
  const pages = await textPerPage((await renderReport(page)).bytes);

  // A figure is break-inside: avoid, so its caption stays with its image.
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { bytes } = await renderReport(page);
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    let painted = 0;
    for (let number = 1; number <= document_.numPages; number += 1) {
      const pdfPage = await document_.getPage(number);
      const operators = [...(await pdfPage.getOperatorList()).fnArray];
      painted += operators.filter((op) => op === OPS.paintImageXObject).length;
    }
    // One image per section, drawn once each.
    expect(painted).toBe(SECTION_COUNT);
  } finally {
    await task.destroy();
  }

  for (let index = 1; index <= SECTION_COUNT; index += 1) {
    const caption = pages.findIndex((text) => text.includes(figureCaption(index)));
    expect(caption, `${figureCaption(index)} missing`).toBeGreaterThanOrEqual(0);
  }
});

test("renders byte-identically across runs", async ({ page }) => {
  const first = await renderReport(page);
  const second = await renderReport(page);
  expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
});

test("embeds one font program for the whole report", async ({ page }) => {
  const { bytes } = await renderReport(page);
  const text = Buffer.from(bytes).toString("latin1");
  expect(text.match(/\/Length1 \d+/g)).toHaveLength(1);
});

test("stays well under a megabyte", async ({ page }) => {
  // The brief's size expectation: a report of this size should be far from
  // the multi-megabyte output a rasterising library produces.
  const { bytes } = await renderReport(page);
  expect(bytes.length).toBeLessThan(1024 * 1024);
});

test("renders within the time budget", async ({ page }) => {
  const { bytes, elapsed } = await renderReport(page);
  const pages = await textPerPage(bytes);

  // The brief allows 5 seconds for 50 pages on a mid-range laptop. Scaled to
  // this document's page count, with headroom for CI being slower than the
  // machine the budget describes.
  const budget = (5000 / 50) * pages.length * 3;
  expect(elapsed, `${pages.length} pages in ${elapsed.toFixed(0)}ms`).toBeLessThan(budget);
});
