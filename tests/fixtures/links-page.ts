/**
 * M7 fixture: links, anchors and headings.
 *
 * The document is long enough to need several pages, so that an in-document
 * link has to reach a target on a page other than its own — which is where a
 * destination stops being a formality and starts being the whole feature.
 */

import { renderFontDataUrl } from "./render-page.js";

export interface LinksPageOptions {
  /** Sections after the table of contents. */
  readonly sections?: number;
  /** Body lines in each section. */
  readonly linesPerSection?: number;
  /** Extra CSS, e.g. `@page` rules. */
  readonly css?: string;
}

export function linksHtml(options: LinksPageOptions = {}): string {
  const sections = options.sections ?? 3;
  const linesPerSection = options.linesPerSection ?? 40;

  const contents = Array.from(
    { length: sections },
    (_, index) => `      <li><a href="#sec-${index + 1}">Jump to section ${index + 1}</a></li>`,
  ).join("\n");

  const body = Array.from({ length: sections }, (_, index) => {
    const number = index + 1;
    const lines = Array.from(
      { length: linesPerSection },
      (_, line) => `      <p>S${number} line ${line + 1}.</p>`,
    ).join("\n");

    return `    <section id="sec-${number}">
      <h2>Section ${number}</h2>
      <h3>Subsection ${number}.1</h3>
${lines}
    </section>`;
  }).join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base href="https://example.com/docs/report.html">
<style>
  @font-face {
    font-family: "Test Mono";
    src: url("${renderFontDataUrl()}") format("truetype");
    font-weight: 400;
    font-style: normal;
  }
  ${options.css ?? "@page { size: Letter; margin: 1in }"}
  html, body { margin: 0; padding: 0; background: rgb(255, 255, 255); }
  #subject {
    font-family: "Test Mono";
    font-size: 13px;
    line-height: 20px;
    color: rgb(20, 20, 20);
  }
  h1 { font-size: 18px; line-height: 24px; margin: 0 0 8px 0; }
  h2 { font-size: 15px; line-height: 22px; margin: 0 0 6px 0; }
  h3 { font-size: 14px; line-height: 20px; margin: 0 0 4px 0; }
  p, li { margin: 0; }
  ul { margin: 0 0 10px 0; padding-left: 20px; }
  a { color: rgb(0, 0, 200); }
</style>
</head>
<body>
  <div id="subject">
    <h1 id="top">Annual Report</h1>
    <ul>
${contents}
      <li><a href="https://example.com/external">An external link</a></li>
      <li><a href="relative/page.html">A relative link</a></li>
      <li><a href="#nowhere">A link to nothing</a></li>
    </ul>
${body}
  </div>
</body>
</html>`;
}

/**
 * A paragraph whose link wraps across line boxes.
 *
 * Narrow enough that the anchor text cannot fit on one line, which is the case
 * a bounding-box implementation gets wrong by making the whole paragraph
 * clickable.
 */
export function wrappedLinkHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base href="https://example.com/docs/report.html">
<style>
  @font-face {
    font-family: "Test Mono";
    src: url("${renderFontDataUrl()}") format("truetype");
    font-weight: 400;
    font-style: normal;
  }
  @page { size: Letter; margin: 1in }
  html, body { margin: 0; padding: 0; background: rgb(255, 255, 255); }
  #subject {
    font-family: "Test Mono";
    font-size: 13px;
    line-height: 20px;
    width: 200px;
    color: rgb(20, 20, 20);
  }
  p { margin: 0; }
</style>
</head>
<body>
  <div id="subject">
    <p>Before the link.</p>
    <p><a href="https://example.com/long">This anchor text is deliberately long enough that it has to wrap across several line boxes.</a></p>
    <p>After the link.</p>
  </div>
</body>
</html>`;
}
