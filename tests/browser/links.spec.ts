/**
 * M7: links, destinations and the outline.
 *
 * Everything here is read back out of the produced PDF with pdf.js, which is
 * the only check that matters — an annotation this library believes it wrote
 * is worth nothing if a viewer cannot find it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { linksHtml, wrappedLinkHtml } from "../fixtures/links-page.js";
import { renderFontBytes } from "../fixtures/render-page.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

async function renderHtml(page: Page, html: string): Promise<Uint8Array> {
  await page.setContent(html, { waitUntil: "load" });
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

interface LoadedPdf {
  readonly annotationsPerPage: Array<Array<Record<string, unknown>>>;
  readonly outline: unknown;
  readonly pageCount: number;
  /** Page index (0-based) each annotation destination resolves to. */
  readonly destinationPages: Map<string, number>;
}

async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const annotationsPerPage: Array<Array<Record<string, unknown>>> = [];
    for (let number = 1; number <= document_.numPages; number += 1) {
      const annotations = await (await document_.getPage(number)).getAnnotations();
      annotationsPerPage.push(annotations as Array<Record<string, unknown>>);
    }

    // pdf.js resolves a destination to a page reference; turning it into an
    // index is what lets a test say "this link lands on page three".
    const destinationPages = new Map<string, number>();
    // pdf.js hands back a Map here, not a plain object; treating it as one
    // silently yields no entries at all.
    const destinations = (await document_.getDestinations()) as unknown as
      | Map<string, unknown[]>
      | Record<string, unknown[]>;
    const entries =
      destinations instanceof Map ? [...destinations] : Object.entries(destinations);

    for (const [name, dest] of entries) {
      const index = await document_.getPageIndex(dest[0] as never);
      destinationPages.set(name, index);
    }

    return {
      annotationsPerPage,
      outline: await document_.getOutline(),
      pageCount: document_.numPages,
      destinationPages,
    };
  } finally {
    await task.destroy();
  }
}

test("turns an external href into a URI annotation", async ({ page }) => {
  const pdf = await loadPdf(await renderHtml(page, linksHtml()));

  const urls = pdf.annotationsPerPage
    .flat()
    .map((annotation) => annotation["url"])
    .filter((url): url is string => typeof url === "string");

  expect(urls).toContain("https://example.com/external");
});

test("resolves a relative href against the document's base URL", async ({ page }) => {
  // A relative href is meaningless once the PDF has left the site it was
  // rendered on, so the annotation has to carry the absolute form.
  const pdf = await loadPdf(await renderHtml(page, linksHtml()));

  const urls = pdf.annotationsPerPage
    .flat()
    .map((annotation) => annotation["url"])
    .filter((url): url is string => typeof url === "string");

  expect(urls).toContain("https://example.com/docs/relative/page.html");
});

test("gives every annotation a link subtype and no visible border", async ({ page }) => {
  const pdf = await loadPdf(await renderHtml(page, linksHtml()));
  const annotations = pdf.annotationsPerPage.flat();

  expect(annotations.length).toBeGreaterThan(0);
  for (const annotation of annotations) {
    expect(annotation["subtype"]).toBe("Link");
    expect(annotation["borderStyle"]).toMatchObject({ width: 0 });
  }
});

test("writes no annotation for a link whose target does not exist", async ({ page }) => {
  const pdf = await loadPdf(await renderHtml(page, linksHtml()));

  // "#nowhere" names no element. A link that silently goes nowhere is worse
  // than no link, so none is written.
  const broken = pdf.annotationsPerPage
    .flat()
    .filter((annotation) => JSON.stringify(annotation).includes("nowhere"));

  expect(broken).toEqual([]);
});

test("points an in-document link at the page its target is on", async ({ page }) => {
  const bytes = await renderHtml(page, linksHtml());
  const pdf = await loadPdf(bytes);

  expect(pdf.pageCount).toBeGreaterThan(2);

  // Each section starts further into the document than the last, so the pages
  // its anchor resolves to must strictly increase.
  const pages = [1, 2, 3].map((number) => pdf.destinationPages.get(`sec-${number}`));

  for (const target of pages) expect(target).toBeDefined();
  expect(pages).toEqual([...(pages as number[])].sort((a, b) => (a as number) - (b as number)));
  expect(pages[2]).toBeGreaterThan(pages[0] as number);
});

test("gives a wrapped link one rectangle per line", async ({ page }) => {
  // The bug a bounding box produces: one rectangle covering every line, which
  // makes the blank space to the right of a short last line clickable.
  const pdf = await loadPdf(await renderHtml(page, wrappedLinkHtml()));
  const annotations = pdf.annotationsPerPage.flat();

  expect(annotations.length).toBeGreaterThan(1);

  const heights = annotations.map((annotation) => {
    const [, bottom, , top] = annotation["rect"] as number[];
    return (top as number) - (bottom as number);
  });

  // Every rectangle is one line tall, not the height of the whole paragraph.
  const tallest = Math.max(...heights);
  expect(tallest).toBeLessThan(25);
});

test("keeps a link rectangle over the text it belongs to", async ({ page }) => {
  const bytes = await renderHtml(page, wrappedLinkHtml());
  const pdf = await loadPdf(bytes);

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const content = await (await document_.getPage(1)).getTextContent();
    const anchorLine = content.items.find(
      (item) => "str" in item && item.str.includes("anchor"),
    );
    expect(anchorLine, "the anchor text was not extracted").toBeDefined();

    const [, , , , x, y] = (anchorLine as { transform: number[] }).transform;
    const covering = pdf.annotationsPerPage[0]?.filter((annotation) => {
      const [left, bottom, right, top] = annotation["rect"] as number[];
      return (
        (x as number) >= (left as number) - 2 &&
        (x as number) <= (right as number) + 2 &&
        (y as number) >= (bottom as number) - 4 &&
        (y as number) <= (top as number) + 4
      );
    });

    expect(covering?.length, "no annotation sits over the anchor's first line").toBeGreaterThan(0);
  } finally {
    await task.destroy();
  }
});

test("builds an outline from the heading hierarchy", async ({ page }) => {
  const pdf = await loadPdf(await renderHtml(page, linksHtml()));
  const outline = pdf.outline as Array<{ title: string; items: Array<{ title: string }> }>;

  expect(outline).toBeTruthy();
  // One h1 at the root, each h2 under it, each h3 under its h2.
  expect(outline).toHaveLength(1);
  expect(outline[0]?.title).toBe("Annual Report");
  expect(outline[0]?.items.map((item) => item.title)).toEqual([
    "Section 1",
    "Section 2",
    "Section 3",
  ]);
  const firstSection = outline[0]?.items[0] as unknown as { items: Array<{ title: string }> };
  expect(firstSection.items.map((item) => item.title)).toEqual(["Subsection 1.1"]);
});

test("gives each outline entry a destination that resolves", async ({ page }) => {
  const bytes = await renderHtml(page, linksHtml());

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const outline = (await document_.getOutline()) as Array<{
      dest: unknown;
      items: Array<{ dest: unknown }>;
    }>;

    const flat: Array<{ dest: unknown }> = [];
    const walk = (items: Array<{ dest: unknown; items?: Array<{ dest: unknown }> }>): void => {
      for (const item of items) {
        flat.push(item);
        if (item.items) walk(item.items as Array<{ dest: unknown; items?: [] }>);
      }
    };
    walk(outline as never);

    expect(flat.length).toBeGreaterThan(3);
    for (const item of flat) {
      expect(item.dest, "an outline entry has no destination").toBeTruthy();
      const index = await document_.getPageIndex((item.dest as unknown[])[0] as never);
      expect(index).toBeGreaterThanOrEqual(0);
    }
  } finally {
    await task.destroy();
  }
});

test("still parses as a valid document", async ({ page }) => {
  const bytes = await renderHtml(page, linksHtml());
  // qpdf runs in CI over every fixture; here the concern is narrower — the
  // annotation and outline objects must not break the page tree.
  const pdf = await loadPdf(bytes);
  expect(pdf.pageCount).toBeGreaterThan(2);
});

test("is deterministic", async ({ page }) => {
  const first = await renderHtml(page, linksHtml());
  const second = await renderHtml(page, linksHtml());
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
});
