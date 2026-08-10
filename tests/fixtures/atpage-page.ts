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

/**
 * A document with sections, for named strings.
 *
 * Each section is long enough to span more than one page, so a running header
 * must carry its heading onto the continuation pages — which is the behaviour
 * that distinguishes a named string from simply printing the nearest heading.
 */
export function sectionedHtml(pageCss: string, sections = 4, linesPerSection = 45): string {
  const body = Array.from({ length: sections }, (_, index) => {
    const number = index + 1;
    const lines = Array.from(
      { length: linesPerSection },
      (_, line) => `      <p>S${number} line ${line + 1}.</p>`,
    ).join("\n");
    return `    <section>
      <h2>CHAPTER-${number}</h2>
${lines}
    </section>`;
  }).join("\n");

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
  h2 { font-size: 15px; line-height: 22px; margin: 0 0 6px 0; }
  p { margin: 0; }
</style>
</head>
<body>
  <div id="subject">
${body}
  </div>
</body>
</html>`;
}

/**
 * Chapters that each demand to open on a right-hand page.
 *
 * Every chapter is deliberately short — under a page — so that the chapter
 * after it would naturally begin on a left-hand page. Honouring
 * `break-before: right` therefore requires generating a blank page, which is
 * the behaviour under test and the reason `@page :blank` exists.
 */
export function rectoChaptersHtml(pageCss: string, chapters = 3, linesPerChapter = 6): string {
  const body = Array.from({ length: chapters }, (_, index) => {
    const number = index + 1;
    const lines = Array.from(
      { length: linesPerChapter },
      (_, line) => `      <p>C${number} line ${line + 1}.</p>`,
    ).join("\n");
    // The first chapter opens the document, so it needs no break of its own.
    const breaks = index === 0 ? "" : ` style="break-before: right"`;
    return `    <section${breaks}>
      <h2>CHAPTER-${number}</h2>
${lines}
    </section>`;
  }).join("\n");

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
  h2 { font-size: 15px; line-height: 22px; margin: 0 0 6px 0; }
  p { margin: 0; }
</style>
</head>
<body>
  <div id="subject">
${body}
  </div>
</body>
</html>`;
}
