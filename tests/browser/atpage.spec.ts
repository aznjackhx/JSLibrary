/**
 * M6.1: `@page` rules read from the document's stylesheets.
 *
 * No page options are passed to render(), so page size and margins can only
 * come from the CSS. If the parser failed, every page would be the default A4
 * with half-inch margins.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { atPageHtml } from "../fixtures/atpage-page.js";
import { renderFontBytes } from "../fixtures/render-page.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

async function renderWithPageCss(page: Page, pageCss: string): Promise<Uint8Array> {
  await page.setContent(atPageHtml(pageCss), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });

  const bytes = await page.evaluate(
    async ({ fontBytes }) => {
      const core = window.PkgCore as CoreModule;
      // Deliberately no pageSize, orientation or margins.
      const pdf = await core.render(document.querySelector("#subject") as Element, {
        metadata: { creationDate: new Date("2024-01-01T00:00:00Z") },
        fonts: [{ family: "Test Mono", data: new Uint8Array(fontBytes) }],
      });
      return [...pdf];
    },
    { fontBytes: [...renderFontBytes()] },
  );

  return new Uint8Array(bytes);
}

/** MediaBox of each page. */
async function pageBoxes(bytes: Uint8Array): Promise<number[][]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const boxes: number[][] = [];
    for (let number = 1; number <= document_.numPages; number += 1) {
      boxes.push([...(await document_.getPage(number)).view]);
    }
    return boxes;
  } finally {
    await task.destroy();
  }
}

test("takes the page size from @page", async ({ page }) => {
  const boxes = await pageBoxes(await renderWithPageCss(page, "@page { size: Letter; margin: 1in }"));

  expect(boxes.length).toBeGreaterThan(1);
  for (const box of boxes) expect(box).toEqual([0, 0, 612, 792]);
});

test("takes a custom size from @page", async ({ page }) => {
  const boxes = await pageBoxes(await renderWithPageCss(page, "@page { size: 5in 7in; margin: 0.5in }"));
  for (const box of boxes) expect(box).toEqual([0, 0, 360, 504]);
});

test("applies orientation from @page", async ({ page }) => {
  const boxes = await pageBoxes(
    await renderWithPageCss(page, "@page { size: Letter landscape; margin: 1in }"),
  );
  for (const box of boxes) expect(box).toEqual([0, 0, 792, 612]);
});

test("gives :first its own margins", async ({ page }) => {
  // A taller top margin on page one leaves it holding fewer lines than the
  // pages that follow.
  const bytes = await renderWithPageCss(
    page,
    "@page { size: Letter; margin: 1in } @page :first { margin-top: 4in }",
  );

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const counts: number[] = [];
    for (let number = 1; number <= document_.numPages; number += 1) {
      const content = await (await document_.getPage(number)).getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join("");
      counts.push((text.match(/Line \d+ of the body\./g) ?? []).length);
    }

    expect(counts.length).toBeGreaterThan(1);
    expect(counts[0], "the first page should hold fewer lines").toBeLessThan(
      counts[1] as number,
    );
  } finally {
    await task.destroy();
  }
});

test("mirrors margins for :left and :right", async ({ page }) => {
  const bytes = await renderWithPageCss(
    page,
    `@page { size: Letter; margin: 1in }
     @page :right { margin-left: 2in }
     @page :left { margin-right: 2in }`,
  );

  const { renderPdfPageToPng } = await import("./pdfjs.js");
  const { PNG } = await import("pngjs");

  /** Leftmost column containing ink. */
  const inkStart = async (pageNumber: number): Promise<number> => {
    const png = PNG.sync.read(await renderPdfPageToPng(page, bytes, { pageNumber, scale: 1 }));
    for (let x = 0; x < png.width; x += 1) {
      for (let y = 0; y < png.height; y += 1) {
        const index = (y * png.width + x) << 2;
        if ((png.data[index] as number) < 200) return x;
      }
    }
    return png.width;
  };

  // Page one is a right-hand page with a 2in left margin; page two is a
  // left-hand page with the standard 1in.
  const first = await inkStart(1);
  const second = await inkStart(2);

  expect(first).toBeGreaterThan(second + 30);
});

test("falls back to the defaults when the document declares nothing", async ({ page }) => {
  const boxes = await pageBoxes(await renderWithPageCss(page, ""));
  // A4 portrait, the library's own default.
  expect(boxes[0]?.[2]).toBeCloseTo(595.276, 2);
});

test("is deterministic", async ({ page }) => {
  const css = "@page { size: Letter; margin: 1in } @page :first { margin-top: 3in }";
  const first = await renderWithPageCss(page, css);
  const second = await renderWithPageCss(page, css);
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
});

test.describe("margin boxes", () => {
  /** Text of each page, in order. */
  async function textPerPage(bytes: Uint8Array): Promise<string[]> {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
    const document_ = await task.promise;

    try {
      const pages: string[] = [];
      for (let number = 1; number <= document_.numPages; number += 1) {
        const content = await (await document_.getPage(number)).getTextContent();
        pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(""));
      }
      return pages;
    } finally {
      await task.destroy();
    }
  }

  test("prints a running footer with the page number and total", async ({ page }) => {
    const pages = await textPerPage(
      await renderWithPageCss(
        page,
        `@page {
           size: Letter; margin: 1in;
           @bottom-center { content: "Page " counter(page) " of " counter(pages); }
         }`,
      ),
    );

    expect(pages.length).toBeGreaterThan(1);
    for (const [index, text] of pages.entries()) {
      expect(text, `page ${index + 1}`).toContain(`Page ${index + 1} of ${pages.length}`);
    }
  });

  test("knows the total without a second pass", async ({ page }) => {
    // Pagination completes before anything is painted, so counter(pages) is a
    // number by the time a margin box is resolved — no placeholder to patch.
    const pages = await textPerPage(
      await renderWithPageCss(
        page,
        `@page { size: Letter; margin: 1in; @top-right { content: counter(pages); } }`,
      ),
    );

    for (const text of pages) expect(text).toContain(String(pages.length));
  });

  test("prints static text in several boxes at once", async ({ page }) => {
    const pages = await textPerPage(
      await renderWithPageCss(
        page,
        `@page {
           size: Letter; margin: 1in;
           @top-left { content: "LEFTBOX"; }
           @top-center { content: "CENTREBOX"; }
           @top-right { content: "RIGHTBOX"; }
           @bottom-left-corner { content: "CORNER"; }
         }`,
      ),
    );

    for (const text of pages) {
      for (const phrase of ["LEFTBOX", "CENTREBOX", "RIGHTBOX", "CORNER"]) {
        expect(text).toContain(phrase);
      }
    }
  });

  test("gives :first its own margin boxes", async ({ page }) => {
    const pages = await textPerPage(
      await renderWithPageCss(
        page,
        `@page { size: Letter; margin: 1in; @top-center { content: "ORDINARY"; } }
         @page :first { @top-center { content: "TITLEPAGE"; } }`,
      ),
    );

    expect(pages[0]).toContain("TITLEPAGE");
    expect(pages[0]).not.toContain("ORDINARY");
    expect(pages[1]).toContain("ORDINARY");
  });

  test("places boxes in the margin, clear of the body", async ({ page }) => {
    const bytes = await renderWithPageCss(
      page,
      `@page {
         size: Letter; margin: 1in;
         @top-center { content: "HEADERTEXT"; }
         @bottom-center { content: "FOOTERTEXT"; }
       }`,
    );

    const { renderPdfPageToPng } = await import("./pdfjs.js");
    const { PNG } = await import("pngjs");
    const png = PNG.sync.read(await renderPdfPageToPng(page, bytes, { scale: 1 }));

    /** Rows containing ink, in PDF points from the top. */
    const inkRows: number[] = [];
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const index = (y * png.width + x) << 2;
        if ((png.data[index] as number) < 200) {
          inkRows.push(y);
          break;
        }
      }
    }

    // The header sits above the 1in top margin's inner edge, the footer below
    // the bottom one. Both are outside the content area entirely.
    expect(Math.min(...inkRows), "nothing painted in the top margin").toBeLessThan(72);
    expect(Math.max(...inkRows), "nothing painted in the bottom margin").toBeGreaterThan(720);
  });

  test("aligns each box within its own third of the edge", async ({ page }) => {
    const bytes = await renderWithPageCss(
      page,
      `@page {
         size: Letter; margin: 1in;
         @top-left { content: "L"; }
         @top-right { content: "R"; }
       }`,
    );

    const { renderPdfPageToPng } = await import("./pdfjs.js");
    const { PNG } = await import("pngjs");
    const png = PNG.sync.read(await renderPdfPageToPng(page, bytes, { scale: 1 }));

    const inkColumns: number[] = [];
    for (let x = 0; x < png.width; x += 1) {
      for (let y = 0; y < 72; y += 1) {
        const index = (y * png.width + x) << 2;
        if ((png.data[index] as number) < 200) {
          inkColumns.push(x);
          break;
        }
      }
    }

    // One mark near the left edge of the content area, one near the right.
    expect(Math.min(...inkColumns)).toBeLessThan(200);
    expect(Math.max(...inkColumns)).toBeGreaterThan(400);
  });

  test("draws nothing for a box with no content", async ({ page }) => {
    const bytes = await renderWithPageCss(
      page,
      `@page { size: Letter; margin: 1in; @top-center { color: red; } }`,
    );

    const { renderPdfPageToPng } = await import("./pdfjs.js");
    const { PNG } = await import("pngjs");
    const png = PNG.sync.read(await renderPdfPageToPng(page, bytes, { scale: 1 }));

    // Scanned into one finding rather than asserted per pixel: 44,000
    // expect() calls take a minute and report the same fact.
    const inked: string[] = [];
    for (let y = 0; y < 72 && inked.length < 5; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const index = (y * png.width + x) << 2;
        if ((png.data[index] as number) <= 200) {
          inked.push(`${x},${y}`);
          break;
        }
      }
    }

    expect(inked, `ink in the top margin: ${inked.join(" ")}`).toEqual([]);
  });
});
