/**
 * M5.1–5.2: multi-page output, with pages ending where content allows.
 *
 * Content survives pagination intact, in order, exactly once, nothing escapes
 * the page, and — since 5.2 — no page boundary divides a line.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  CONTENT_HEIGHT_PX,
  PARAGRAPH_COUNT,
  pagedPageHtml,
  paragraphText,
} from "../fixtures/paged-page.js";
import { renderFontBytes } from "../fixtures/render-page.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

async function openPagedPage(page: Page): Promise<void> {
  await page.setContent(pagedPageHtml(), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });
}

async function renderPaged(page: Page): Promise<Uint8Array> {
  const bytes = await page.evaluate(
    async ({ fontBytes }) => {
      const core = window.PkgCore as CoreModule;
      const pdf = await core.render(document.querySelector("#subject") as Element, {
        pageSize: "Letter",
        margins: "0.5in",
        metadata: { title: "M5.1 pagination", creationDate: new Date("2024-01-01T00:00:00Z") },
        fonts: [{ family: "Test Mono", data: new Uint8Array(fontBytes) }],
      });
      return [...pdf];
    },
    { fontBytes: [...renderFontBytes()] },
  );

  return new Uint8Array(bytes);
}

/** Text of every page, in order. */
async function textPerPage(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Copied: pdf.js transfers the buffer to its worker and detaches it, so the
  // caller's bytes would be unusable for any later parse.
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

test.beforeEach(async ({ page }) => {
  await openPagedPage(page);
});

test("emits more than one page for content taller than a page", async ({ page }) => {
  const pages = await textPerPage(await renderPaged(page));
  expect(pages.length).toBeGreaterThan(1);
});

test("keeps every paragraph, exactly once, in order", async ({ page }) => {
  const pages = await textPerPage(await renderPaged(page));
  const combined = pages.join("");

  for (let index = 1; index <= PARAGRAPH_COUNT; index += 1) {
    const text = paragraphText(index);
    const occurrences = combined.split(text).length - 1;
    expect(occurrences, `"${text}" should appear once`).toBe(1);
  }

  // And in document order across the page boundaries.
  const positions = Array.from({ length: PARAGRAPH_COUNT }, (_, index) =>
    combined.indexOf(paragraphText(index + 1)),
  );
  const sorted = [...positions].sort((a, b) => a - b);
  expect(positions).toEqual(sorted);
});

test("puts different content on different pages", async ({ page }) => {
  const pages = await textPerPage(await renderPaged(page));

  expect(pages[0]).toContain("Paragraph 1 of");
  expect(pages[0]).not.toContain(`Paragraph ${PARAGRAPH_COUNT} of`);
  expect(pages[pages.length - 1]).toContain(`Paragraph ${PARAGRAPH_COUNT} of`);
});

test("gives every page the same declared size", async ({ page }) => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: (await renderPaged(page)).slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    for (let number = 1; number <= document_.numPages; number += 1) {
      const pdfPage = await document_.getPage(number);
      expect(pdfPage.view).toEqual([0, 0, 612, 792]);
    }
  } finally {
    await task.destroy();
  }
});

test("paints nothing outside the page content box", async ({ page }) => {
  // A box taller than the page must stop at the margin, not bleed across it.
  // Every page is clipped to the content area, so the margins stay blank.
  const { renderPdfPageToPng } = await import("./pdfjs.js");
  const { PNG } = await import("pngjs");

  const png = PNG.sync.read(await renderPdfPageToPng(page, await renderPaged(page), { scale: 1 }));

  // 0.5in margin at 72dpi is 36 points, and the page is rendered at 1pt per
  // pixel here.
  const margin = 36;
  const isWhite = (x: number, y: number): boolean => {
    const index = (y * png.width + x) << 2;
    return (
      (png.data[index] as number) === 255 &&
      (png.data[index + 1] as number) === 255 &&
      (png.data[index + 2] as number) === 255
    );
  };

  // Scanned into a single finding rather than asserted per pixel: a million
  // expect() calls take minutes and report the same fact.
  const painted: string[] = [];
  const check = (x: number, y: number): void => {
    if (painted.length < 5 && !isWhite(x, y)) painted.push(`${x},${y}`);
  };

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < margin; x += 1) {
      check(x, y);
      check(png.width - 1 - x, y);
    }
  }
  for (let x = 0; x < png.width; x += 1) {
    for (let y = 0; y < margin; y += 1) {
      check(x, y);
      check(x, png.height - 1 - y);
    }
  }

  expect(painted, `pixels painted in the margin: ${painted.join(" ")}`).toEqual([]);
});

test("embeds one font for the whole document, not one per page", async ({ page }) => {
  // Subsets accumulate across pages; a per-page subset would mean the font
  // program appears once for every page that uses it.
  const bytes = await renderPaged(page);
  const text = Buffer.from(bytes).toString("latin1");

  // The descriptor holding /FontFile2 is packed into an object stream, so it is
  // not visible in the raw bytes. The font program itself is a stream, which
  // never is, and /Length1 appears exactly once per embedded program.
  expect(text.match(/\/Length1 \d+/g)).toHaveLength(1);
});

test("is deterministic across renders", async ({ page }) => {
  const first = await renderPaged(page);
  const second = await renderPaged(page);
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
});

test("page count follows the content height", async ({ page }) => {
  const pages = await textPerPage(await renderPaged(page));

  const measuredHeight = await page.evaluate(
    () => (document.querySelector("#subject") as HTMLElement).getBoundingClientRect().height,
  );

  // Not an equality: pages now end above a line that would not fit, so each
  // one can carry slightly less than its full height and the count can exceed
  // the naive ceiling. It must never be fewer, and the slack is bounded — a
  // page is never given up for less than one line of content.
  const minimum = Math.ceil(measuredHeight / CONTENT_HEIGHT_PX);
  expect(pages.length).toBeGreaterThanOrEqual(minimum);
  expect(pages.length).toBeLessThanOrEqual(minimum + 1);
});


test("never cuts a line across a page boundary", async ({ page }) => {
  // The artifact 5.2 exists to remove. A break placed without regard for
  // content leaves half a line's glyphs painted at the page edge; a break
  // chosen above the offending line leaves the page short instead.
  const pages = await textPerPage(await renderPaged(page));

  for (const [index, text] of pages.entries()) {
    // Every paragraph on a page is whole: its full sentence, not a fragment.
    const fragments = text.match(/Paragraph \d+ of \d+\./g) ?? [];
    const partial = text.match(/Paragraph \d+ of \d*$/);

    expect(partial, `page ${index + 1} ends mid-sentence: ${text.slice(-40)}`).toBeNull();
    expect(fragments.length).toBeGreaterThan(0);
  }
});

test("fills each page rather than breaking early", async ({ page }) => {
  // A correct break is the *latest* legal one. Breaking at the first
  // opportunity would also never divide a line, and would waste most of
  // every page.
  const pdf = await renderPaged(page);
  const pages = await textPerPage(pdf);

  const perPage = pages.map((text) => (text.match(/Paragraph \d+ of/g) ?? []).length);

  // Page 1 also carries the bordered box, and the last page is short by
  // definition. The pages in between hold nothing but uniform paragraphs, so
  // their counts are directly comparable: one holding fewer than its
  // neighbours means its break was taken earlier than it needed to be.
  const uniform = perPage.slice(1, -1);
  expect(uniform.length, "fixture should span enough pages to compare").toBeGreaterThan(0);

  const most = Math.max(...uniform);
  for (const [index, count] of uniform.entries()) {
    expect(count, `page ${index + 2} holds ${count} of up to ${most}`).toBeGreaterThanOrEqual(
      most - 1,
    );
  }
});
