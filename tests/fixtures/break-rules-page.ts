/**
 * Fixtures for the individual fragmentation rules.
 *
 * One page per rule, each built so that the *absence* of the rule produces a
 * visibly different result. A fixture where the rule makes no difference proves
 * nothing about whether it is implemented.
 */

import { renderFontDataUrl } from "./render-page.js";

export const CONTENT_WIDTH_PX = 720;
export const CONTENT_HEIGHT_PX = 960;
export const LINE_HEIGHT_PX = 24;

/** Enough lines to fill roughly one page. */
export const LINES_PER_PAGE = Math.floor(CONTENT_HEIGHT_PX / LINE_HEIGHT_PX);

function shell(body: string): string {
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
    line-height: ${LINE_HEIGHT_PX}px;
    color: rgb(20, 20, 20);
  }
  p { margin: 0; }
  .filler { color: rgb(80, 80, 80); }
  .keep { break-inside: avoid; background-color: rgb(240, 240, 250); }
  .new-page { break-before: page; }
  .after-page { break-after: page; }
  img { display: block; }
</style>
</head>
<body>
  <div id="subject">
${body}
  </div>
</body>
</html>`;
}

const filler = (count: number, prefix: string): string =>
  Array.from(
    { length: count },
    (_, index) => `    <p class="filler">${prefix} line ${index + 1}.</p>`,
  ).join("\n");

/** `break-before: page` moves an element to the top of a fresh page. */
export function breakBeforeHtml(): string {
  return shell(
    `${filler(5, "Before")}
    <p class="new-page" id="target">FORCED START.</p>
${filler(5, "After")}`,
  );
}

/** `break-after: page` ends the page immediately after an element. */
export function breakAfterHtml(): string {
  return shell(
    `${filler(5, "Before")}
    <p class="after-page" id="target">FORCED END.</p>
${filler(5, "After")}`,
  );
}

/**
 * A block marked `break-inside: avoid`, positioned so that it would straddle a
 * page boundary if the rule were ignored.
 */
export function avoidInsideHtml(): string {
  // Fill most of the page, then a block too tall for the remainder.
  const before = LINES_PER_PAGE - 4;
  const blockLines = Array.from(
    { length: 8 },
    (_, index) => `      <p>KEEP line ${index + 1}.</p>`,
  ).join("\n");

  return shell(
    `${filler(before, "Filler")}
    <div class="keep" id="target">
${blockLines}
    </div>
${filler(10, "Trailing")}`,
  );
}

/**
 * An image positioned to straddle a page boundary.
 *
 * A 4×4 source scaled to 200px tall: large enough that slicing it would be
 * unmistakable, small enough to inline.
 */
export function atomicImageHtml(imageDataUrl: string): string {
  const before = LINES_PER_PAGE - 3;
  return shell(
    `${filler(before, "Filler")}
    <img id="target" src="${imageDataUrl}" width="300" height="200" alt="atomic">
${filler(10, "Trailing")}`,
  );
}

/**
 * A paragraph positioned so that a naive break would strand its first line at
 * the foot of the page, and another positioned to strand its last line at the
 * top of the next.
 */
export function strandingHtml(orphans: number, widows: number): string {
  // Leave room for exactly one line of the paragraph at the foot of the page.
  const before = LINES_PER_PAGE - 1;
  const paragraph = Array.from({ length: 6 }, (_, index) => `STRANDED line ${index + 1}.`).join(
    " ",
  );

  return shell(
    `${filler(before, "Filler")}
    <p id="target" style="orphans: ${orphans}; widows: ${widows};">${paragraph}</p>
${filler(6, "Trailing")}`,
  );
}

/**
 * A bordered box tall enough to span a page boundary.
 *
 * `decoration` selects `slice` (the CSS default: the box is drawn as though
 * continuous and then cut, so no border appears at the seam) or `clone` (the
 * box is closed on each page and reopened on the next).
 */
export function spanningBoxHtml(decoration: "slice" | "clone"): string {
  const before = LINES_PER_PAGE - 6;
  const boxLines = Array.from(
    { length: 20 },
    (_, index) => `      <p>BOX line ${index + 1}.</p>`,
  ).join("\n");

  return shell(
    `${filler(before, "Filler")}
    <div id="target" style="border: 4px solid rgb(200, 0, 0); background: rgb(240, 240, 250); padding: 6px; box-decoration-break: ${decoration}; -webkit-box-decoration-break: ${decoration};">
${boxLines}
    </div>
${filler(4, "Trailing")}`,
  );
}

/** An image taller than the page has nowhere to go and must overflow. */
export function oversizedImageHtml(imageDataUrl: string): string {
  return shell(
    `${filler(3, "Filler")}
    <img id="target" src="${imageDataUrl}" width="300" height="${CONTENT_HEIGHT_PX + 200}" alt="oversized">
${filler(5, "Trailing")}`,
  );
}
