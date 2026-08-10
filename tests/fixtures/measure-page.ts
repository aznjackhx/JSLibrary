/**
 * M3 measurement fixture.
 *
 * The page embeds its font as a data URL and never names a system font. That is
 * deliberate: measurement output is geometry, and geometry that depends on
 * whichever fonts a machine happens to have installed cannot be compared across
 * runs, let alone across CI machines.
 *
 * The content is chosen to exercise the cases the walk has to get right: text
 * that soft-wraps, nested boxes with borders and padding, a table, an image, a
 * link, fragmentation hints, and elements that must be pruned.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FONT_PATH = fileURLToPath(new URL("./fonts/DejaVuSansMono.ttf", import.meta.url));

let cachedFontUrl: string | undefined;

/** The test font as a data URL, so the page fetches nothing. */
export function fontDataUrl(): string {
  cachedFontUrl ??= `data:font/ttf;base64,${readFileSync(FONT_PATH).toString("base64")}`;
  return cachedFontUrl;
}

/**
 * A 2×1 PNG, red and blue.
 *
 * Generated, not written by hand. An earlier version of this constant had a bad
 * IDAT checksum: Chromium rendered it regardless, Firefox correctly refused and
 * laid out the alt text instead, and the resulting 38.5px measurement looked
 * exactly like a bug in the measurement code.
 */
export const TEST_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mO4Iyf3X87mzn8AEU0ETf5ImaAAAAAASUVORK5CYII=";

/** Width the fixture is measured at, in CSS pixels. */
export const MEASURE_WIDTH = 400;

/**
 * Font size and the resulting character advance.
 *
 * DejaVu Sans Mono is monospaced at 1233/2048 em, so at 16px every character
 * advances 9.6328125px. That makes wrapping arithmetic exact rather than
 * approximate, which is what lets the tests assert real numbers.
 */
export const FONT_SIZE = 16;
export const CHAR_WIDTH = (1233 / 2048) * FONT_SIZE;

export function measurePageHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: "Test Mono";
    src: url("${fontDataUrl()}") format("truetype");
    font-weight: 400;
    font-style: normal;
  }
  html, body {
    margin: 0;
    padding: 0;
  }
  body {
    /* No system font is ever named: everything resolves to the embedded face. */
    font-family: "Test Mono";
    font-size: ${FONT_SIZE}px;
    line-height: 24px;
    color: rgb(17, 17, 17);
  }
  #subject {
    width: ${MEASURE_WIDTH}px;
  }
  .card {
    border: 2px solid rgb(200, 0, 0);
    border-radius: 4px;
    padding: 8px 10px;
    margin: 0 0 12px 0;
    background-color: rgb(240, 240, 250);
  }
  .keep-together {
    break-inside: avoid;
  }
  .page-break {
    break-before: page;
  }
  h1 {
    font-size: 24px;
    line-height: 32px;
    margin: 0 0 8px 0;
    font-weight: 700;
  }
  p {
    margin: 0 0 8px 0;
    orphans: 3;
    widows: 4;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th, td {
    border: 1px solid rgb(0, 0, 200);
    padding: 2px 4px;
    text-align: left;
  }
  .hidden-none { display: none; }
  .transparent { color: rgba(0, 0, 0, 0.5); }
  img { width: 120px; height: 60px; }
</style>
</head>
<body>
  <!-- The theme wrapper exists to prove inherited styles survive cloning: the
       subject is measured out of this context, so without the copy its font
       size would revert to the default. -->
  <div id="theme" style="font-size: ${FONT_SIZE}px; line-height: 24px; color: rgb(17, 17, 17); font-family: 'Test Mono';">
    <div id="subject">
      <h1 id="title">Measurement</h1>

      <p id="wrapping">The quick brown fox jumps over the lazy dog and keeps on running past the fence.</p>

      <p id="accented">Ünïcödé — café ✓</p>

      <div class="card" id="card">
        <p id="nested">Inside a bordered card with padding.</p>
      </div>

      <div class="card keep-together" id="atomic">
        <p>This block must not be split.</p>
      </div>

      <table id="grid">
        <thead>
          <tr><th id="head-a">Item</th><th>Amount</th></tr>
        </thead>
        <tbody>
          <tr><td id="cell-a">Alpha</td><td>100</td></tr>
          <tr><td>Beta</td><td>200</td></tr>
        </tbody>
      </table>

      <p><a id="link" href="https://example.test/target">A link</a></p>

      <p id="image-holder"><img id="picture" src="${TEST_IMAGE}" alt="test"></p>

      <p class="page-break" id="after-break">After a forced break.</p>

      <div class="hidden-none" id="gone">Never measured.</div>
      <script>window.__shouldNotBeMeasured = true;</script>
    </div>
  </div>
</body>
</html>`;
}
