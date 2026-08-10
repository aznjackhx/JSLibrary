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

test.describe("all sixteen margin boxes", () => {
  /** Every text item on page one, with the position it was painted at. */
  async function placedItems(bytes: Uint8Array): Promise<Map<string, { x: number; y: number }>> {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
    const document_ = await task.promise;

    try {
      const content = await (await document_.getPage(1)).getTextContent();
      const placed = new Map<string, { x: number; y: number }>();
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const [, , , , x, y] = item.transform as number[];
        placed.set(item.str, { x: x as number, y: y as number });
      }
      return placed;
    } finally {
      await task.destroy();
    }
  }

  // A distinct token per box, short enough to fit a one-inch margin.
  const BOXES = [
    "top-left-corner",
    "top-left",
    "top-center",
    "top-right",
    "top-right-corner",
    "right-top",
    "right-middle",
    "right-bottom",
    "bottom-right-corner",
    "bottom-right",
    "bottom-center",
    "bottom-left",
    "bottom-left-corner",
    "left-bottom",
    "left-middle",
    "left-top",
  ] as const;

  const token = (name: string): string => `X${BOXES.indexOf(name as never) + 1}`;

  const allBoxesCss = `@page {
      size: Letter; margin: 1in;
      ${BOXES.map((name) => `@${name} { content: "${token(name)}"; }`).join("\n      ")}
    }`;

  test("paints every one of them", async ({ page }) => {
    const placed = await placedItems(await renderWithPageCss(page, allBoxesCss));

    const missing = BOXES.filter((name) => !placed.has(token(name)));
    expect(missing, "margin boxes that printed nothing").toEqual([]);
  });

  test("puts each box in the margin its name says", async ({ page }) => {
    const placed = await placedItems(await renderWithPageCss(page, allBoxesCss));
    const at = (name: string): { x: number; y: number } =>
      placed.get(token(name)) as { x: number; y: number };

    // Letter is 612x792pt with a 72pt margin, so the content box is
    // 72..540 across and 72..720 up.
    const wrong: string[] = [];
    for (const name of BOXES) {
      const { x, y } = at(name);
      if (name.startsWith("top-") && y < 720) wrong.push(`${name} not in the top margin`);
      if (name.startsWith("bottom-") && y > 72) wrong.push(`${name} not in the bottom margin`);
      if (name.startsWith("left-") && x >= 72) wrong.push(`${name} not in the left margin`);
      if (name.startsWith("right-") && x < 540) wrong.push(`${name} not in the right margin`);
    }

    expect(wrong).toEqual([]);
  });

  test("orders the side boxes down the edge", async ({ page }) => {
    const placed = await placedItems(await renderWithPageCss(page, allBoxesCss));
    const y = (name: string): number => (placed.get(token(name)) as { y: number }).y;

    for (const edge of ["left", "right"]) {
      expect(y(`${edge}-top`), `${edge} edge`).toBeGreaterThan(y(`${edge}-middle`));
      expect(y(`${edge}-middle`), `${edge} edge`).toBeGreaterThan(y(`${edge}-bottom`));
    }
  });

  test("keeps the boxes on an edge from overlapping", async ({ page }) => {
    const placed = await placedItems(await renderWithPageCss(page, allBoxesCss));
    const x = (name: string): number => (placed.get(token(name)) as { x: number }).x;

    // Each edge is divided into thirds, so left sits before centre sits before
    // right — two boxes claiming the full edge would print on top of each other.
    for (const edge of ["top", "bottom"]) {
      expect(x(`${edge}-left-corner`), `${edge} edge`).toBeLessThan(x(`${edge}-left`));
      expect(x(`${edge}-left`), `${edge} edge`).toBeLessThan(x(`${edge}-center`));
      expect(x(`${edge}-center`), `${edge} edge`).toBeLessThan(x(`${edge}-right`));
      expect(x(`${edge}-right`), `${edge} edge`).toBeLessThan(x(`${edge}-right-corner`));
    }
  });
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

test.describe("named strings", () => {
  async function renderSectioned(page: Page, pageCss: string): Promise<Uint8Array> {
    const { sectionedHtml } = await import("../fixtures/atpage-page.js");
    // Sections are deliberately longer than a page, so that continuation pages
    // — the ones a named string exists for — actually occur.
    await page.setContent(sectionedHtml(pageCss, 3, 100), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });

    const bytes = await page.evaluate(
      async ({ fontBytes }) => {
        const core = window.PkgCore as CoreModule;
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

  /**
   * Both readings of a page, because neither alone is safe.
   *
   * `text` concatenates the items, which is the only way body words come back
   * as "S1 line 1." — the words and the spaces between them are separate text
   * items. But concatenation also fuses the header "CHAPTER-4" with the footer
   * "5" into "CHAPTER-45", so anything looking for a margin box reads `items`.
   */
  interface PageText {
    readonly text: string;
    readonly items: readonly string[];
  }

  async function pageTexts(bytes: Uint8Array): Promise<PageText[]> {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
    const document_ = await task.promise;

    try {
      const pages: PageText[] = [];
      for (let number = 1; number <= document_.numPages; number += 1) {
        const content = await (await document_.getPage(number)).getTextContent();
        const items = content.items.map((item) => ("str" in item ? item.str : ""));
        pages.push({ text: items.join(""), items });
      }
      return pages;
    } finally {
      await task.destroy();
    }
  }

  /** Chapters named by this page's margin boxes, not by its body. */
  function headerChapters(page: PageText): string[] {
    return page.items
      .map((item) => /^(?:Section: )?CHAPTER-(\d+)$/.exec(item.trim())?.[1])
      .filter((value): value is string => value !== undefined);
  }

  const runningHeaderCss = `
    h2 { string-set: chapter content(); }
    @page {
      size: Letter; margin: 1in;
      @top-right { content: string(chapter); }
      @bottom-center { content: counter(page); }
    }`;

  test("prints the current section in the running header", async ({ page }) => {
    const pages = await pageTexts(await renderSectioned(page, runningHeaderCss));

    expect(pages.length).toBeGreaterThan(3);

    for (const [index, page_] of pages.entries()) {
      // Whichever chapter's body is on this page is the one named in its header.
      const bodyChapters = [...page_.text.matchAll(/S(\d+) line/g)].map((match) => match[1]);
      if (bodyChapters.length === 0) continue;

      const header = headerChapters(page_)[0];
      expect(header, `page ${index + 1} has no running header`).toBeDefined();
      expect(
        bodyChapters,
        `page ${index + 1} header says ${header} but carries chapters ${bodyChapters.join()}`,
      ).toContain(header);
    }
  });

  test("carries the heading onto continuation pages", async ({ page }) => {
    // The distinguishing behaviour of a named string: a page that contains no
    // heading of its own still names the section it belongs to. Such a page
    // mentions its chapter exactly once — in the header — whereas the page the
    // heading actually falls on mentions it twice.
    const pages = await pageTexts(await renderSectioned(page, runningHeaderCss));

    let continuationPages = 0;

    for (const [index, page_] of pages.entries()) {
      const bodyChapters = new Set(
        [...page_.text.matchAll(/S(\d+) line/g)].map((match) => match[1]),
      );
      if (bodyChapters.size !== 1) continue;

      const chapter = [...bodyChapters][0] as string;
      expect(
        headerChapters(page_),
        `page ${index + 1} never names chapter ${chapter}`,
      ).toContain(chapter);

      // The heading itself is body text, so a page carrying it mentions the
      // chapter once more than its margin boxes do; on a continuation page the
      // header's mention is the only one.
      const mentions = page_.text.split(`CHAPTER-${chapter}`).length - 1;
      const inMarginBoxes = headerChapters(page_).filter((name) => name === chapter).length;
      if (mentions === inMarginBoxes) continuationPages += 1;
    }

    expect(continuationPages, "no continuation page in the fixture").toBeGreaterThan(0);
  });

  test("changes the header when a new section starts", async ({ page }) => {
    const pages = await pageTexts(await renderSectioned(page, runningHeaderCss));
    const headers = pages
      .map((page_) => headerChapters(page_)[0])
      .filter((value): value is string => value !== undefined);

    // More than one distinct chapter appears across the document's headers.
    expect(new Set(headers).size).toBeGreaterThan(1);
    // And they never go backwards.
    const numbers = headers.map(Number);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  test("combines a named string with literal text", async ({ page }) => {
    const pages = await pageTexts(
      await renderSectioned(
        page,
        `h2 { string-set: chapter content(); }
         @page {
           size: Letter; margin: 1in;
           @top-left { content: "Section: " string(chapter); }
         }`,
      ),
    );

    for (const page_ of pages) {
      if (!/S\d+ line/.test(page_.text)) continue;
      expect(page_.text).toMatch(/Section: CHAPTER-\d+/);
    }
  });

  test("prints nothing for a name that was never set", async ({ page }) => {
    const pages = await pageTexts(
      await renderSectioned(
        page,
        `@page { size: Letter; margin: 1in; @top-center { content: string(missing); } }`,
      ),
    );

    for (const page_ of pages) expect(page_.text).not.toContain("undefined");
  });
});

test.describe("side-specific breaks", () => {
  async function renderRecto(page: Page, pageCss: string): Promise<Uint8Array> {
    const { rectoChaptersHtml } = await import("../fixtures/atpage-page.js");
    await page.setContent(rectoChaptersHtml(pageCss), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });

    const bytes = await page.evaluate(
      async ({ fontBytes }) => {
        const core = window.PkgCore as CoreModule;
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

  /** Concatenated text of each page. */
  async function texts(bytes: Uint8Array): Promise<string[]> {
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

  const rectoCss = "@page { size: Letter; margin: 1in }";

  test("opens every chapter on a right-hand page", async ({ page }) => {
    const pages = await texts(await renderRecto(page, rectoCss));

    for (const [index, text] of pages.entries()) {
      const opens = /CHAPTER-(\d+)/.exec(text);
      if (!opens) continue;
      // Page one is a right-hand page, so right-hand pages are even indices.
      expect(index % 2, `chapter ${opens[1]} opened on a left-hand page`).toBe(0);
    }
  });

  test("generates a blank page to reach the demanded side", async ({ page }) => {
    const pages = await texts(await renderRecto(page, rectoCss));

    // Three short chapters would fit on two pages without the rule; honouring
    // it costs a blank page between each pair.
    expect(pages.length).toBe(5);
    expect(pages[1]?.trim()).toBe("");
    expect(pages[3]?.trim()).toBe("");
    expect(pages[0]).toContain("CHAPTER-1");
    expect(pages[2]).toContain("CHAPTER-2");
    expect(pages[4]).toContain("CHAPTER-3");
  });

  test("loses no content to the pages it generates", async ({ page }) => {
    const all = (await texts(await renderRecto(page, rectoCss))).join("");

    for (let chapter = 1; chapter <= 3; chapter += 1) {
      for (let line = 1; line <= 6; line += 1) {
        expect(all, `C${chapter} line ${line}`).toContain(`C${chapter} line ${line}.`);
      }
    }
  });

  test("numbers a generated page like any other", async ({ page }) => {
    const pages = await texts(
      await renderRecto(
        page,
        `@page {
           size: Letter; margin: 1in;
           @bottom-center { content: counter(page) " of " counter(pages); }
         }`,
      ),
    );

    // A blank page is still a sheet of paper: it is counted and it is numbered.
    for (const [index, text] of pages.entries()) {
      expect(text, `page ${index + 1}`).toContain(`${index + 1} of ${pages.length}`);
    }
  });

  test("lets @page :blank strip the running header", async ({ page }) => {
    const pages = await texts(
      await renderRecto(
        page,
        `@page {
           size: Letter; margin: 1in;
           @top-center { content: "RUNNING-HEADER"; }
         }
         @page :blank { @top-center { content: none; } }`,
      ),
    );

    expect(pages[0]).toContain("RUNNING-HEADER");
    expect(pages[1], "the generated page kept a header it should not have").not.toContain(
      "RUNNING-HEADER",
    );
  });

  test("is deterministic", async ({ page }) => {
    const first = await renderRecto(page, rectoCss);
    const second = await renderRecto(page, rectoCss);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});
