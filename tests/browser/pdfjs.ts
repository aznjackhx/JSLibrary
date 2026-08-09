/**
 * Render a PDF to PNG inside the browser using pdf.js.
 *
 * This is the rasteriser behind visual regression: our output goes in, a bitmap
 * comes out, and the harness compares it to a golden. pdf.js is loaded from
 * blob URLs so the page needs no server and makes no network request.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { Page } from "@playwright/test";

const require = createRequire(import.meta.url);

/**
 * The legacy build is deliberate: it targets older engines, so the same
 * rasteriser runs on whatever browser build CI or a dev container happens to
 * ship. The modern build reaches for very recent builtins and fails on them.
 */
function pdfjsSource(file: string): string {
  return readFileSync(require.resolve(`pdfjs-dist/legacy/build/${file}`), "utf8");
}

export interface RenderPdfOptions {
  /** 1-based page number. */
  readonly pageNumber?: number;
  /** Rendering scale; 1 means one canvas pixel per PDF point. */
  readonly scale?: number;
}

/**
 * Rasterise one page of a PDF and return the PNG bytes.
 *
 * The page is left on `about:blank`; nothing is fetched over the network.
 */
export async function renderPdfPageToPng(
  page: Page,
  pdfBytes: Uint8Array,
  options: RenderPdfOptions = {},
): Promise<Buffer> {
  const pageNumber = options.pageNumber ?? 1;
  const scale = options.scale ?? 1;

  await page.goto("about:blank");

  const dataUrl = await page.evaluate(
    async ({ pdfSource, workerSource, bytes, pageNumber: which, scale: zoom }) => {
      const toBlobUrl = (source: string): string =>
        URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

      const pdfjs = (await import(
        /* @vite-ignore */ toBlobUrl(pdfSource)
      )) as typeof import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = toBlobUrl(workerSource);

      const document_ = await pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: false,
      }).promise;

      const pdfPage = await document_.getPage(which);
      const viewport = pdfPage.getViewport({ scale: zoom });

      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D canvas context unavailable");

      // White ground: a PDF page is paper, and an unpainted canvas is
      // transparent, which would compare as a different image per browser.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;

      return canvas.toDataURL("image/png");
    },
    {
      pdfSource: pdfjsSource("pdf.min.mjs"),
      workerSource: pdfjsSource("pdf.worker.min.mjs"),
      bytes: [...pdfBytes],
      pageNumber,
      scale,
    },
  );

  return Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
}
