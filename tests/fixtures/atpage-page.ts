/**
 * M6.1 fixture: a document that declares its own page setup in CSS.
 *
 * The library is given no page options at all, so anything correct about the
 * output comes from the stylesheet.
 */

import { renderFontDataUrl } from "./render-page.js";

export const LINES = 90;

export function atPageHtml(pageCss: string): string {
  const filler = Array.from(
    { length: LINES },
    (_, index) => `    <p>Line ${index + 1} of the body.</p>`,
  ).join("\n");

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
  ${pageCss}
  html, body { margin: 0; padding: 0; background: rgb(255, 255, 255); }
  #subject {
    font-family: "Test Mono";
    font-size: 13px;
    line-height: 20px;
    color: rgb(20, 20, 20);
  }
  p { margin: 0; }
</style>
</head>
<body>
  <div id="subject">
${filler}
  </div>
</body>
</html>`;
}
