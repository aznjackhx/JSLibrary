/**
 * Whitespace that a layout collapses.
 *
 * Ordinary HTML wraps a paragraph across several source lines, so its text
 * nodes are full of newlines and indentation. The browser renders each run as
 * a single space. Recording the source characters instead asks the font for a
 * glyph for U+000A, which no font has — and the reader prints a tofu box at
 * every wrap.
 *
 * That is exactly what the first demo render did, and none of the fixtures
 * caught it because they were all written with each paragraph on one line.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { renderFontBytes, renderFontDataUrl } from "../fixtures/render-page.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

/** A paragraph written the way anyone writes one: across several lines. */
function wrappedSourceHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: "Test Mono";
    src: url("${renderFontDataUrl()}") format("truetype");
    font-weight: 400;
    font-style: normal;
  }
  html, body { margin: 0; padding: 0; background: rgb(255, 255, 255); }
  #subject {
    width: 400px;
    font-family: "Test Mono";
    font-size: 13px;
    line-height: 20px;
    color: rgb(20, 20, 20);
  }
  p { margin: 0 0 8px; }
</style>
</head>
<body>
  <div id="subject">
    <p>
      Alpha bravo charlie delta echo foxtrot golf hotel india juliet
      kilo lima mike november oscar papa quebec romeo sierra tango.
    </p>
    <p>
      A paragraph with <strong>an inline element</strong> in the middle
      of it, and a
      <a href="https://example.com/">link across the boundary</a>
      as well.
    </p>
    <p>Tabs\tand   runs   of   spaces   collapse   too.</p>
  </div>
</body>
</html>`;
}

async function render(page: Page): Promise<Uint8Array> {
  await page.setContent(wrappedSourceHtml(), { waitUntil: "load" });
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

/** Every text item on page one. */
async function textItems(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const content = await (await document_.getPage(1)).getTextContent();
    return content.items.map((item) => ("str" in item ? item.str : ""));
  } finally {
    await task.destroy();
  }
}

/**
 * Page one as flowing text, with line breaks restored.
 *
 * A PDF line is its own text run, and the space that ended it was never
 * painted — correctly, since a trailing space at a wrap is not drawn. Joining
 * the runs directly therefore reads "novemberoscar", which looks exactly like
 * the bug under test and is not. pdf.js marks the end of a line with `hasEOL`,
 * so that is where the break goes back in.
 */
async function flowingText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const document_ = await task.promise;

  try {
    const content = await (await document_.getPage(1)).getTextContent();
    return content.items
      .map((item) =>
        "str" in item ? item.str + ((item as { hasEOL?: boolean }).hasEOL ? "\n" : "") : "",
      )
      .join("");
  } finally {
    await task.destroy();
  }
}

test("extracts exactly what the browser shows", async ({ page }) => {
  // The strongest form of the check, and the only one that catches the bug on
  // its own: a .notdef glyph extracts as an empty string, so "no empty items"
  // and "no control characters" are both satisfied by the broken output too.
  // Comparing against the browser's own rendered text is not — the missing
  // space shows up immediately.
  const bytes = await render(page);
  const shown = await page.evaluate(
    () => (document.querySelector("#subject") as HTMLElement).innerText,
  );

  const normalise = (value: string): string => value.replaceAll(/\s+/g, " ").trim();

  expect(normalise(await flowingText(bytes))).toBe(normalise(shown));
});

test("renders a source-wrapped paragraph as ordinary spaced text", async ({ page }) => {
  const text = (await textItems(await render(page))).join("");

  expect(text).toContain("Alpha bravo charlie delta echo");
  // The newline between "juliet" and "kilo" in the source is one space here.
  expect(text).toContain("juliet kilo lima");
});

test("keeps words apart across an inline element boundary", async ({ page }) => {
  const text = (await textItems(await render(page))).join("");

  // Dropping collapsed whitespace entirely would give "withan inline".
  expect(text).toContain("with an inline element in the middle");
  expect(text).not.toMatch(/withan|elementin/);
});

test("collapses tabs and runs of spaces to one space", async ({ page }) => {
  const text = (await textItems(await render(page))).join("");

  expect(text).toContain("Tabs and runs of spaces collapse too.");
});

test("hands the font no character it cannot draw", async ({ page }) => {
  const text = (await textItems(await render(page))).join("");

  // Nothing downstream should ever be asked to draw a newline or a tab. This
  // does not catch the bug by itself — the unmapped glyph extracts as nothing
  // — but it pins the intent that only renderable characters get this far.
  expect(text).not.toMatch(/[\n\r\t]/);
});
