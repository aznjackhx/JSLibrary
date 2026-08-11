/**
 * What a caller is told when something they supplied is wrong.
 *
 * A message that names the input and the fix is the difference between a
 * five-minute problem and an afternoon of bisecting font files, and it is the
 * kind of thing no other test would notice regressing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { renderFontBytes } from "../fixtures/render-page.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div id="subject"><p>Hello</p></div></body></html>`;

/** Render and return the error message, or "" if it succeeded. */
async function messageFor(
  page: import("@playwright/test").Page,
  fonts: { family: string; weight?: number; data: number[] }[],
): Promise<string> {
  await page.setContent(PAGE, { waitUntil: "load" });
  await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });

  return page.evaluate(async ({ fonts }) => {
    const core = window.PkgCore as CoreModule;
    try {
      await core.render(document.querySelector("#subject") as Element, {
        fonts: fonts.map((font) => ({
          family: font.family,
          ...(font.weight === undefined ? {} : { weight: font.weight }),
          data: new Uint8Array(font.data),
        })),
      });
      return "";
    } catch (error) {
      return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }, { fonts });
}

test("names the font that could not be parsed", async ({ page }) => {
  // Bytes that are not a font: the shape of a fetch that returned an error
  // page instead of the file, which is the common real cause.
  const notAFont = [...new TextEncoder().encode("<!doctype html><title>404</title>")];

  const message = await messageFor(page, [
    { family: "Good Sans", data: [...renderFontBytes()] },
    { family: "Brand Sans", weight: 700, data: notAFont },
  ]);

  // The offending face, and not the innocent one.
  expect(message).toContain("FontError");
  expect(message).toContain('"Brand Sans" 700');
  expect(message).not.toContain("Good Sans");

  // And what to do about it.
  expect(message).toContain("options.fonts");
});

test("says why rendering with no fonts cannot work", async ({ page }) => {
  const message = await messageFor(page, []);

  expect(message).toContain("options.fonts");
  expect(message).toContain("no network requests");
});
