/**
 * M5.3 and M5.5: the individual break rules, each with its own fixture.
 *
 * Every fixture is built so that ignoring the rule produces a different,
 * detectable result — otherwise the test would pass whether or not the rule
 * exists.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  atomicImageHtml,
  avoidInsideHtml,
  breakAfterHtml,
  breakBeforeHtml,
  oversizedImageHtml,
  spanningBoxHtml,
  strandingHtml,
} from "../fixtures/break-rules-page.js";
import { ALPHA_IMAGE, renderFontBytes } from "../fixtures/render-page.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

interface RenderOverrides {
  readonly orphans?: number;
  readonly widows?: number;
}

async function renderHtml(
  page: Page,
  html: string,
  overrides: RenderOverrides = {},
): Promise<Uint8Array> {
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].map(async (image) => {
        try {
          await image.decode();
        } catch {
          /* reported by the fixture-image test */
        }
      }),
    );
  });
  await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });

  const bytes = await page.evaluate(
    async ({ fontBytes, overrides: passed }) => {
      const core = window.PkgCore as CoreModule;
      const pdf = await core.render(document.querySelector("#subject") as Element, {
        pageSize: "Letter",
        margins: "0.5in",
        metadata: { creationDate: new Date("2024-01-01T00:00:00Z") },
        fonts: [{ family: "Test Mono", data: new Uint8Array(fontBytes) }],
        ...passed,
      });
      return [...pdf];
    },
    { fontBytes: [...renderFontBytes()], overrides },
  );

  return new Uint8Array(bytes);
}

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

/** Page index (1-based) of the page containing a phrase, or 0. */
function pageContaining(pages: readonly string[], phrase: string): number {
  return pages.findIndex((text) => text.includes(phrase)) + 1;
}

test.describe("break-before: page", () => {
  test("moves the element to the top of a new page", async ({ page }) => {
    const pages = await textPerPage(await renderHtml(page, breakBeforeHtml()));

    // Without the rule everything fits on one page.
    expect(pages.length).toBeGreaterThan(1);
    expect(pageContaining(pages, "FORCED START.")).toBe(2);
    expect(pageContaining(pages, "Before line 1.")).toBe(1);
  });

  test("starts the page with it, with nothing above", async ({ page }) => {
    const pages = await textPerPage(await renderHtml(page, breakBeforeHtml()));
    expect(pages[1]?.startsWith("FORCED START.")).toBe(true);
  });
});

test.describe("break-after: page", () => {
  test("ends the page immediately after the element", async ({ page }) => {
    const pages = await textPerPage(await renderHtml(page, breakAfterHtml()));

    expect(pages.length).toBeGreaterThan(1);
    expect(pageContaining(pages, "FORCED END.")).toBe(1);
    // The element stays on its page; what follows does not.
    expect(pages[0]).not.toContain("After line 1.");
    expect(pageContaining(pages, "After line 1.")).toBe(2);
  });
});

test.describe("break-inside: avoid", () => {
  test("moves the whole block rather than dividing it", async ({ page }) => {
    const pages = await textPerPage(await renderHtml(page, avoidInsideHtml()));

    // Every line of the block lands on the same page.
    const pagesWithBlock = new Set<number>();
    for (let line = 1; line <= 8; line += 1) {
      const found = pageContaining(pages, `KEEP line ${line}.`);
      expect(found, `KEEP line ${line} should be on a page`).toBeGreaterThan(0);
      pagesWithBlock.add(found);
    }

    expect([...pagesWithBlock], "block split across pages").toHaveLength(1);
  });

  test("leaves the page it moved off short rather than splitting", async ({ page }) => {
    const pages = await textPerPage(await renderHtml(page, avoidInsideHtml()));
    // The block moved to page 2, so page 1 ends with filler.
    expect(pages[0]).toContain("Filler line 1.");
    expect(pages[0]).not.toContain("KEEP line 1.");
  });
});

test.describe("replaced content", () => {
  test("never divides an image across a page boundary", async ({ page }) => {
    const bytes = await renderHtml(page, atomicImageHtml(ALPHA_IMAGE));
    const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
    const document_ = await task.promise;

    try {
      // The image is painted on exactly one page. Painted on two, it would have
      // been sliced by the boundary.
      let pagesWithImage = 0;
      for (let number = 1; number <= document_.numPages; number += 1) {
        const pdfPage = await document_.getPage(number);
        const operators = [...(await pdfPage.getOperatorList()).fnArray];
        if (operators.includes(OPS.paintImageXObject)) pagesWithImage += 1;
      }

      expect(document_.numPages).toBeGreaterThan(1);
      expect(pagesWithImage).toBe(1);
    } finally {
      await task.destroy();
    }
  });

  test("places an image taller than the page rather than dropping it", async ({ page }) => {
    const bytes = await renderHtml(page, oversizedImageHtml(ALPHA_IMAGE));
    const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
    const document_ = await task.promise;

    try {
      // There is no legal break for it, so it overflows — but it is still
      // drawn, and the content after it still follows.
      let painted = false;
      for (let number = 1; number <= document_.numPages; number += 1) {
        const pdfPage = await document_.getPage(number);
        const operators = [...(await pdfPage.getOperatorList()).fnArray];
        if (operators.includes(OPS.paintImageXObject)) painted = true;
      }
      expect(painted).toBe(true);
    } finally {
      await task.destroy();
    }

    const pages = await textPerPage(bytes);
    expect(pageContaining(pages, "Trailing line 1.")).toBeGreaterThan(0);
  });
});


test.describe("orphans and widows", () => {
  /** How many lines of the target paragraph landed on each page. */
  const spread = (pages: readonly string[]): number[] =>
    pages.map((text) => (text.match(/STRANDED line \d+\./g) ?? []).length);

  test("does not strand a single line at the foot of a page", async ({ page }) => {
    // The fixture leaves room for exactly one line at the page foot, which is
    // what a break ignoring orphans would put there.
    const pages = await textPerPage(await renderHtml(page, strandingHtml(2, 2)));
    const counts = spread(pages).filter((count) => count > 0);

    expect(counts.length).toBeGreaterThan(0);
    // With orphans and widows both 2, no page may carry a single line of it:
    // one at the foot is an orphan, one at the head is a widow.
    for (const count of counts) {
      expect(count, `a page carries ${count} line(s) of the paragraph`).toBeGreaterThanOrEqual(2);
    }
  });

  test("moves the paragraph whole when it cannot be split acceptably", async ({ page }) => {
    // Minimums larger than half the paragraph make every internal break
    // illegal, so the whole thing must move.
    const pages = await textPerPage(await renderHtml(page, strandingHtml(4, 4)));
    const counts = spread(pages).filter((count) => count > 0);

    expect(counts, "paragraph was split despite no legal break").toHaveLength(1);
    expect(counts[0]).toBe(6);
  });

  test("honours minimums supplied through options", async ({ page }) => {
    // The engine may not expose the CSS properties at all — Firefox does not —
    // so the same result has to be reachable from options.
    const viaOptions = await textPerPage(
      await renderHtml(page, strandingHtml(1, 1), { orphans: 4, widows: 4 }),
    );
    const counts = viaOptions.map(
      (text) => (text.match(/STRANDED line \d+\./g) ?? []).length,
    ).filter((count) => count > 0);

    expect(counts).toHaveLength(1);
  });

  test("allows a split when both sides meet their minimum", async ({ page }) => {
    // With minimums of 1 the paragraph may divide wherever it likes, so the
    // page fills rather than pushing the paragraph over.
    const pages = await textPerPage(await renderHtml(page, strandingHtml(1, 1)));
    const counts = spread(pages).filter((count) => count > 0);

    expect(counts.length).toBeGreaterThan(1);
  });
});

test.describe("box decoration across a break", () => {
  /**
   * Count the horizontal border runs of the target box on a page, by looking
   * for rows of its border colour spanning most of the content width.
   */
  async function borderRowsPerPage(page: Page, html: string): Promise<number[]> {
    const bytes = await renderHtml(page, html);
    const { renderPdfPageToPng } = await import("./pdfjs.js");
    const { PNG } = await import("pngjs");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
    const document_ = await task.promise;
    const pageCount = document_.numPages;
    await task.destroy();

    const counts: number[] = [];
    for (let number = 1; number <= pageCount; number += 1) {
      const png = PNG.sync.read(
        await renderPdfPageToPng(page, bytes, { pageNumber: number, scale: 1 }),
      );

      let rows = 0;
      for (let y = 0; y < png.height; y += 1) {
        let red = 0;
        for (let x = 0; x < png.width; x += 1) {
          const index = (y * png.width + x) << 2;
          const r = png.data[index] as number;
          const g = png.data[index + 1] as number;
          const b = png.data[index + 2] as number;
          if (r > 150 && g < 100 && b < 100) red += 1;
        }
        // A horizontal border run spans most of the box's width.
        if (red > png.width / 2) rows += 1;
      }
      counts.push(rows);
    }
    return counts;
  }

  test("clone draws more border than slice, and closes each fragment", async ({ page }) => {
    const sliced = await borderRowsPerPage(page, spanningBoxHtml("slice"));
    const cloned = await borderRowsPerPage(page, spanningBoxHtml("clone"));

    const slicedPages = sliced.filter((count) => count > 0);
    const clonedPages = cloned.filter((count) => count > 0);

    expect(slicedPages.length, "box should span more than one page").toBeGreaterThan(1);
    expect(clonedPages.length).toBeGreaterThan(1);

    // Slice draws the box as though continuous and then cut: one border at the
    // very top, one at the very bottom, and nothing at the seam. Clone closes
    // every fragment, so each page the box touches gains an extra edge.
    const total = (counts: number[]): number => counts.reduce((sum, count) => sum + count, 0);

    expect(
      total(cloned),
      `slice ${sliced.join("/")} vs clone ${cloned.join("/")}`,
    ).toBeGreaterThan(total(sliced));

    // Every page the box touches carries at least one horizontal edge under
    // clone; under slice the middle of a three-page box carries none.
    for (const count of clonedPages) {
      expect(count, `clone fragment with ${count} border rows`).toBeGreaterThanOrEqual(4);
    }
  });
});
