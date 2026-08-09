/**
 * M5.1 fixture: content tall enough to need several pages.
 *
 * Every paragraph is individually identifiable, so a test can prove that all of
 * them survived pagination, in order, exactly once. That is the property naive
 * slicing is most likely to break — a paragraph dropped between two bands, or
 * counted on both.
 */

import { renderFontDataUrl } from "./render-page.js";

/** Letter minus 0.5in margins, in CSS pixels. */
export const CONTENT_WIDTH_PX = 720;
export const CONTENT_HEIGHT_PX = 960;

/** Enough paragraphs to span roughly three pages at this line height. */
export const PARAGRAPH_COUNT = 60;

export const paragraphText = (index: number): string =>
  `Paragraph ${index} of ${PARAGRAPH_COUNT}.`;

export function pagedPageHtml(): string {
  const paragraphs = Array.from(
    { length: PARAGRAPH_COUNT },
    (_, index) => `<p id="p${index + 1}">${paragraphText(index + 1)}</p>`,
  ).join("\n      ");

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
    line-height: 24px;
    color: rgb(20, 20, 20);
  }
  p { margin: 0 0 12px 0; }
  /* A box tall enough to span a page boundary, to prove boxes are clipped to
     the content area rather than bleeding into the margins. */
  #tall-box {
    border: 2px solid rgb(200, 30, 30);
    background-color: rgb(245, 245, 230);
    padding: 8px;
    margin: 0 0 12px 0;
  }
</style>
</head>
<body>
  <div id="subject">
    <div id="tall-box">
      <p id="box-line-1">Inside a box that spans a page boundary.</p>
      <p id="box-line-2">Second line of the same box.</p>
      <p id="box-line-3">Third line of the same box.</p>
    </div>
      ${paragraphs}
  </div>
</body>
</html>`;
}
