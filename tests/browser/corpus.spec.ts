/**
 * The corpus, held to one set of invariants.
 *
 * Adding a document to `tests/fixtures/corpus` adds coverage without adding
 * assertions, which is the point: the fixtures that came before this were each
 * written alongside the feature they exercised, and a whole class of bug walked
 * straight through the gap between them.
 *
 * The invariants are deliberately about *what a reader gets*, not about what
 * the emitter believes it wrote.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { CORPUS, fontBytes, type CorpusDocument } from "../fixtures/corpus/index.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

async function renderDocument(page: Page, document_: CorpusDocument): Promise<Uint8Array> {
  await page.setContent(document_.html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });

  const fonts = document_.fonts.map((font) => ({
    family: font.family,
    weight: font.weight ?? 400,
    data: [...fontBytes(font.file)],
  }));

  const bytes = await page.evaluate(
    async ({ fonts }) => {
      const core = window.PkgCore as CoreModule;
      const pdf = await core.render(document.querySelector("#subject") as Element, {
        metadata: { creationDate: new Date("2024-01-01T00:00:00Z") },
        fonts: fonts.map((font) => ({
          family: font.family,
          weight: font.weight,
          data: new Uint8Array(font.data),
        })),
      });
      return [...pdf];
    },
    { fonts },
  );

  return new Uint8Array(bytes);
}

interface Extracted {
  readonly pages: number;
  /** Reading text, with line breaks restored from `hasEOL`. */
  readonly text: string;
  /** Count of image XObjects painted across the document. */
  readonly images: number;
}

async function extract(bytes: Uint8Array): Promise<Extracted> {
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    let text = "";
    let images = 0;

    for (let number = 1; number <= document_.numPages; number += 1) {
      const page = await document_.getPage(number);
      const content = await page.getTextContent();

      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str + ((item as { hasEOL?: boolean }).hasEOL ? "\n" : "");
      }

      const operators = await page.getOperatorList();
      images += operators.fnArray.filter(
        (fn) => fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject,
      ).length;
    }

    return { pages: document_.numPages, text, images };
  } finally {
    await task.destroy();
  }
}

const normalise = (value: string): string => value.replaceAll(/\s+/g, " ").trim();

/** A string's characters in a fixed order, for order-insensitive comparison. */
const sorted = (value: string): string =>
  [...value.replaceAll(" ", "")].sort().join("");

/** How many times each character occurs, ignoring spaces. */
function tally(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const character of value.replaceAll(" ", "")) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  return counts;
}

/**
 * Every character the browser showed, at least as often, somewhere in the PDF.
 *
 * Containment rather than equality, because page furniture legitimately adds
 * text the source never had. Counted rather than merely present, so losing one
 * of a repeated word still fails. Deliberately blind to order: furniture is
 * interleaved with the prose it sits between, and a paragraph split across a
 * page break has a page number extracted in the middle of it.
 */
function missingFrom(extracted: string, shown: string): string[] {
  const available = tally(extracted);
  const gaps: string[] = [];

  for (const [character, needed] of tally(shown)) {
    const have = available.get(character) ?? 0;
    if (have < needed) gaps.push(`${JSON.stringify(character)} ${have}/${needed}`);
  }
  return gaps;
}

for (const document_ of CORPUS) {
  test.describe(document_.name, () => {
    test(`renders — ${document_.purpose}`, async ({ page }) => {
      const bytes = await renderDocument(page, document_);
      const result = await extract(bytes);

      expect(result.pages).toBeGreaterThanOrEqual(document_.minPages ?? 1);
      expect(bytes.length).toBeGreaterThan(0);
    });

    test("says what the browser shows", async ({ page }) => {
      // The invariant that caught the tofu bug, and the reason it exists: a
      // glyph the font cannot supply extracts as nothing, so only a comparison
      // against the rendered text notices it is missing.
      //
      // A document with a known gap asserts the *failure*, so closing the gap
      // turns CI red and the annotation has to be removed. A gap that quietly
      // starts passing is one nobody notices has closed.
      if (document_.knownGap) test.fail(true, document_.knownGap);

      const bytes = await renderDocument(page, document_);
      const shown = await page.evaluate(
        () => (document.querySelector("#subject") as HTMLElement).innerText,
      );

      const extracted = normalise((await extract(bytes)).text);
      const expected = normalise(shown);

      if (document_.roundTrip === "superset") {
        expect(missingFrom(extracted, expected)).toEqual([]);
        return;
      }

      if (document_.roundTrip === "unordered") {
        // Same characters, any order: still catches anything dropped or
        // unmapped, without asserting an extractor's reading order.
        expect(sorted(extracted)).toBe(sorted(expected));
        return;
      }

      expect(extracted).toBe(expected);
    });

    test("paints images, and only images, as pixels", async ({ page }) => {
      // For a document with no images, any image XObject is text that got
      // turned into pixels — the failure this library exists to avoid. For a
      // document that has them, the exact count also catches one being
      // dropped, which nothing else here would notice.
      const bytes = await renderDocument(page, document_);
      const result = await extract(bytes);
      expect(result.images).toBe(document_.expectedImages ?? 0);

      if (!document_.imageWidths) return;

      // Read straight from the image dictionaries. They are written
      // uncompressed by this library's own writer, which is what makes a
      // regex defensible here — it is reading our output, not parsing PDF in
      // general.
      const widths = [...Buffer.from(bytes).toString("latin1").matchAll(/\/Width (\d+)/g)]
        .map((match) => Number(match[1]))
        .sort((a, b) => a - b);

      expect(widths).toEqual([...document_.imageWidths].sort((a, b) => a - b));
    });

    test("is deterministic", async ({ page }) => {
      const first = await renderDocument(page, document_);
      const second = await renderDocument(page, document_);
      expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    });
  });
}
