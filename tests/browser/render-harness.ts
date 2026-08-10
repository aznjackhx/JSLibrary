/**
 * Running the full pipeline in a browser and getting the bytes back.
 *
 * `render()` only works inside a browser, so the test drives it there and
 * transfers the resulting PDF out as a plain array — the one place where the
 * boundary costs anything.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { renderFontBytes, renderPageHtml } from "../fixtures/render-page.js";

const CORE_BUNDLE = resolve(import.meta.dirname, "../../packages/core/dist/index.global.js");

type CoreModule = typeof import("@pkg/core");

/** Load the fixture page with the public bundle available and fonts settled. */
export async function openRenderPage(page: Page): Promise<void> {
  await page.setContent(renderPageHtml(), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  // Images must be decoded before measurement reads their pixels.
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].map((image) => (image.complete ? undefined : image.decode())),
    );
  });
  await page.addScriptTag({ content: readFileSync(CORE_BUNDLE, "utf8") });
}

export interface RenderFixtureOptions {
  readonly textMode?: "precise" | "fast";
  readonly selector?: string;
}

/** Render the fixture's subject through the public API. */
export async function renderSubject(
  page: Page,
  options: RenderFixtureOptions = {},
): Promise<Uint8Array> {
  const bytes = await page.evaluate(
    async ({ fontBytes, textMode, selector }) => {
      const subject = document.querySelector(selector);
      if (!subject) throw new Error(`fixture is missing ${selector}`);

      const core = window.PkgCore as CoreModule;
      const pdf = await core.render(subject, {
        pageSize: "Letter",
        margins: "0.5in",
        textMode,
        metadata: { title: "M4 emission", creationDate: new Date("2024-01-01T00:00:00Z") },
        fonts: [{ family: "Test Mono", data: new Uint8Array(fontBytes) }],
      });

      return [...pdf];
    },
    {
      fontBytes: [...renderFontBytes()],
      textMode: options.textMode ?? ("precise" as const),
      selector: options.selector ?? "#subject",
    },
  );

  return new Uint8Array(bytes);
}

/** Screenshot the fixture's subject exactly as the browser painted it. */
export async function screenshotSubject(page: Page, selector = "#subject"): Promise<Buffer> {
  const element = page.locator(selector);
  return element.screenshot({ scale: "css" });
}
