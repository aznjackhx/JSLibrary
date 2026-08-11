/**
 * M5.7: tables that span pages.
 *
 * The header must appear on every page the table reaches — the feature the
 * brief calls the most requested missing one in competing libraries — and rows
 * must survive intact, in order, exactly once.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  HEADER_PHRASE,
  FOOTER_PHRASE,
  ROW_COUNT,
  rowLabel,
  tablePageHtml,
  tallRowTableHtml,
  NOTE_LINES,
  noteLine,
} from "../fixtures/table-page.js";
import { renderFontBytes } from "../fixtures/render-page.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

async function renderTable(page: Page, footer = false): Promise<Uint8Array> {
  return renderHtml(page, tablePageHtml({ footer }));
}

async function renderHtml(page: Page, html: string): Promise<Uint8Array> {
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });

  const bytes = await page.evaluate(
    async ({ fontBytes }) => {
      const core = window.PkgCore as CoreModule;
      const pdf = await core.render(document.querySelector("#subject") as Element, {
        pageSize: "Letter",
        margins: "0.5in",
        metadata: { creationDate: new Date("2024-01-01T00:00:00Z") },
        fonts: [{ family: "Test Mono", data: new Uint8Array(fontBytes) }],
      });
      return [...pdf];
    },
    { fontBytes: [...renderFontBytes()] },
  );

  return new Uint8Array(bytes);
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

test("repeats the header on every page the table spans", async ({ page }) => {
  const pages = await textPerPage(await renderTable(page));

  expect(pages.length, "fixture should span several pages").toBeGreaterThan(2);

  // Which pages carry rows, and which carry the header.
  const rowPages = pages
    .map((text, index) => (/Row \d+ data\./.test(text) ? index : -1))
    .filter((index) => index >= 0);
  const headerPages = pages
    .map((text, index) => (text.includes(HEADER_PHRASE) ? index : -1))
    .filter((index) => index >= 0);

  expect(rowPages.length).toBeGreaterThan(2);
  // Every page showing rows shows the header.
  expect(headerPages).toEqual(expect.arrayContaining(rowPages));
});

test("shows the header exactly once per page", async ({ page }) => {
  const pages = await textPerPage(await renderTable(page));

  for (const [index, text] of pages.entries()) {
    const occurrences = text.split(HEADER_PHRASE).length - 1;
    expect(occurrences, `page ${index + 1} shows the header ${occurrences} times`).toBeLessThanOrEqual(1);
  }
});

test("keeps every row, exactly once, in order", async ({ page }) => {
  const combined = (await textPerPage(await renderTable(page))).join("");

  for (let index = 1; index <= ROW_COUNT; index += 1) {
    const occurrences = combined.split(rowLabel(index)).length - 1;
    expect(occurrences, `${rowLabel(index)} appears ${occurrences} times`).toBe(1);
  }

  const positions = Array.from({ length: ROW_COUNT }, (_, index) =>
    combined.indexOf(rowLabel(index + 1)),
  );
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});

test("starts each continuation page with the header, above the rows", async ({ page }) => {
  const pages = await textPerPage(await renderTable(page));

  // Pages after the first that carry rows begin with the repeated header.
  const continuations = pages.slice(1).filter((text) => /Row \d+ data\./.test(text));
  expect(continuations.length).toBeGreaterThan(1);

  for (const text of continuations) {
    expect(text.startsWith(HEADER_PHRASE)).toBe(true);
  }
});

test("repeats the footer at the foot of every page the table spans", async ({ page }) => {
  const pages = await textPerPage(await renderTable(page, true));

  const rowPages = pages
    .map((text, index) => (/Row \d+ data\./.test(text) ? index : -1))
    .filter((index) => index >= 0);
  const footerPages = pages
    .map((text, index) => (text.includes(FOOTER_PHRASE) ? index : -1))
    .filter((index) => index >= 0);

  expect(rowPages.length).toBeGreaterThan(2);
  // Every page carrying rows carries the footer. Reserving the space without
  // painting it would leave a gap instead.
  expect(footerPages).toEqual(expect.arrayContaining(rowPages));
});

test("places the repeated footer below the rows, not above them", async ({ page }) => {
  const pages = await textPerPage(await renderTable(page, true));
  const rowPages = pages
    .map((text, index) => (/Row \d+ data\./.test(text) ? index : -1))
    .filter((index) => index >= 0);

  // Every page the table continues past — so, all but its last — repeats the
  // footer beneath that page's rows. The final page has the footer in its
  // natural position and is followed by what comes after the table.
  const continuing = rowPages.slice(0, -1);
  expect(continuing.length).toBeGreaterThan(1);

  for (const index of continuing) {
    const text = pages[index] as string;
    const lastRow = text.lastIndexOf("Row ");
    const footer = text.indexOf(FOOTER_PHRASE);

    expect(footer, `page ${index + 1} has no footer`).toBeGreaterThanOrEqual(0);
    expect(footer, `page ${index + 1} places the footer above its rows`).toBeGreaterThan(lastRow);
  }
});

test("does not lose rows to the space the header occupies", async ({ page }) => {
  // The repeated header consumes vertical space, so fewer rows fit on
  // continuation pages than on the first. Rows must still all be present —
  // this is the failure mode of painting a header without reserving room.
  const pages = await textPerPage(await renderTable(page));
  const perPage = pages.map((text) => (text.match(/Row \d+ data\./g) ?? []).length);

  expect(perPage.reduce((sum, count) => sum + count, 0)).toBe(ROW_COUNT);
});

test("is deterministic", async ({ page }) => {
  const first = await renderTable(page);
  const second = await renderTable(page);
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
});

test("divides a row taller than a page instead of losing its tail", async ({ page }) => {
  // The row's note is longer than a page can hold, so the row cannot be kept
  // whole. What used to happen is that the page ended *below* the row: every
  // line was still written into the first page's content stream, but most of
  // them sat past the bottom edge where the page clip hides them.
  //
  // So extraction alone proves nothing here — it finds text a reader can never
  // see. The invariant is about position: everything painted has to land
  // inside the page it was painted on.
  const pdf = await renderHtml(page, tallRowTableHtml());

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: pdf.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const offPage: string[] = [];
    const seen: string[] = [];

    for (let number = 1; number <= document_.numPages; number += 1) {
      const rendered = await document_.getPage(number);
      const [, , , height] = rendered.view as number[];
      const content = await rendered.getTextContent();

      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        seen.push(item.str);

        const y = item.transform[5] as number;
        if (y < 0 || y > (height as number)) {
          offPage.push(`${item.str} at y=${y.toFixed(1)} on page ${number}`);
        }
      }
    }

    expect(offPage.slice(0, 5), "text painted outside the page").toEqual([]);

    const text = seen.join(" ");
    for (const index of [1, Math.floor(NOTE_LINES / 2), NOTE_LINES]) {
      expect(text, `missing note line ${index}`).toContain(noteLine(index));
    }

    // The rows either side of it survive, in order.
    expect(text.indexOf(rowLabel(1))).toBeLessThan(text.indexOf(noteLine(1)));
    expect(text.indexOf(noteLine(NOTE_LINES))).toBeLessThan(text.indexOf(rowLabel(3)));
  } finally {
    await task.destroy();
  }
});
