/**
 * M4 exit-test fixture.
 *
 * A single page whose rendering can be compared against the browser's own,
 * pixel for pixel. Every construct in it is one the emitter has to get right:
 * wrapped text, nested boxes with borders and padding, a rounded corner, a
 * table, an image, colour, and a decorated link.
 *
 * The page dimensions are chosen so the content box is exactly the element's
 * size, which lets the comparison screenshot the element directly rather than
 * having to reason about margins.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FONT_PATH = fileURLToPath(new URL("./fonts/DejaVuSansMono.ttf", import.meta.url));

let cachedFontUrl: string | undefined;
let cachedFontBytes: Uint8Array | undefined;

export function renderFontBytes(): Uint8Array {
  cachedFontBytes ??= new Uint8Array(readFileSync(FONT_PATH));
  return cachedFontBytes;
}

export function renderFontDataUrl(): string {
  cachedFontUrl ??= `data:font/ttf;base64,${readFileSync(FONT_PATH).toString("base64")}`;
  return cachedFontUrl;
}

/** A 4×4 PNG with an alpha gradient, to exercise the soft mask path. */
export const ALPHA_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAKklEQVR4nGP8z8Dwn4GBgYGRAQ0wYRfAKcHIwMDwH5sEE07jsUpQRQIAO4UGAQrEAaAAAAAASUVORK5CYII=";

/**
 * Page content box width, in CSS pixels.
 *
 * Letter is 612pt wide; 0.5in margins take 36pt from each side, leaving 540pt,
 * which is 720 CSS pixels at 96dpi. The fixture is laid out at exactly that
 * width so the browser's own rendering and the page's rendering break lines in
 * the same places — otherwise the comparison measures the difference between
 * two layouts rather than the fidelity of the emitter.
 */
export const CONTENT_WIDTH_PX = 720;

export const FIXED_DATE = new Date("2024-01-01T00:00:00Z");

export function renderPageHtml(): string {
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
    width: ${CONTENT_WIDTH_PX}px;
    font-family: "Test Mono";
    font-size: 14px;
    line-height: 21px;
    color: rgb(20, 20, 20);
    background: rgb(255, 255, 255);
  }
  h1 {
    font-size: 22px;
    line-height: 30px;
    margin: 0 0 10px 0;
    color: rgb(10, 40, 120);
  }
  p { margin: 0 0 10px 0; }
  .card {
    border: 3px solid rgb(200, 30, 30);
    background-color: rgb(245, 245, 230);
    padding: 6px 8px;
    margin: 0 0 10px 0;
  }
  .rounded {
    border: 2px solid rgb(20, 120, 60);
    border-radius: 8px;
    background-color: rgb(230, 245, 235);
    padding: 6px 8px;
    margin: 0 0 10px 0;
  }
  .mixed {
    border-top: 4px solid rgb(0, 0, 200);
    border-right: 2px solid rgb(200, 0, 200);
    border-bottom: 6px solid rgb(0, 150, 150);
    border-left: 1px solid rgb(120, 120, 0);
    padding: 4px 6px;
    margin: 0 0 10px 0;
  }
  table { border-collapse: collapse; width: 100%; margin: 0 0 10px 0; }
  th, td {
    border: 1px solid rgb(90, 90, 90);
    padding: 2px 5px;
    text-align: left;
  }
  th { background-color: rgb(235, 235, 235); }
  a { color: rgb(0, 90, 200); text-decoration: underline; }
  img { width: 64px; height: 32px; display: block; }
</style>
</head>
<body>
  <div id="subject">
    <h1>Emission</h1>

    <p>Text that wraps across more than one line so the emitter has to place every line where the browser did, not where arithmetic suggests.</p>

    <div class="card">Solid border, padding and a background fill.</div>

    <div class="rounded">Rounded corners, uniform border.</div>

    <div class="mixed">Four borders of differing width and colour, mitred.</div>

    <table>
      <thead>
        <tr><th>Item</th><th>Amount</th></tr>
      </thead>
      <tbody>
        <tr><td>Alpha</td><td>100.00</td></tr>
        <tr><td>Beta</td><td>250.00</td></tr>
      </tbody>
    </table>

    <p><a href="https://example.test/">An underlined link</a></p>

    <p>Ünïcödé — café ✓</p>

    <img src="${ALPHA_IMAGE}" alt="alpha">
  </div>
</body>
</html>`;
}
