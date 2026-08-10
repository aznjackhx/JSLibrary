/**
 * M5.9: the long-form report from the brief's fixture corpus.
 *
 * Deliberately mixed: headings that must not be stranded from what follows,
 * prose that wraps, a financial table long enough to span pages, images that
 * must not be sliced, and blocks that must stay together. The point of a corpus
 * fixture is that the rules interact — each has its own focused fixture
 * already.
 */

import { ALPHA_IMAGE, renderFontDataUrl } from "./render-page.js";

export const CONTENT_WIDTH_PX = 720;
export const SECTION_COUNT = 12;
export const ROWS_PER_TABLE = 24;

/**
 * Markers are zero-padded and punctuated so that no marker is a substring of
 * another: "Section 1" would otherwise match inside "Section 10", and counting
 * occurrences would report duplication that is not there.
 */
const pad = (value: number): string => String(value).padStart(2, "0");

export const sectionTitle = (index: number): string => `[SECTION-${pad(index)}]`;
export const rowLabel = (section: number, row: number): string =>
  `[S${pad(section)}R${pad(row)}]`;
export const tableHeader = (index: number): string => `[ENTRY-${pad(index)}]`;
export const figureCaption = (index: number): string => `[FIGURE-${pad(index)}]`;

function section(index: number): string {
  const paragraphs = Array.from(
    { length: 3 },
    (_, p) =>
      `      <p>Section ${index} paragraph ${p + 1}. ` +
      "Prose long enough to wrap across more than a single line so that the " +
      "fragmenter has real line boxes to reason about when it decides where " +
      "this page should end.</p>",
  ).join("\n");

  const rows = Array.from(
    { length: ROWS_PER_TABLE },
    (_, r) =>
      `          <tr><td>${rowLabel(index, r + 1)}</td><td>${(r + 1) * 7}.50</td></tr>`,
  ).join("\n");

  return `    <section>
      <h2 class="keep-with-next">${sectionTitle(index)}</h2>
${paragraphs}
      <figure class="atomic">
        <img src="${ALPHA_IMAGE}" width="180" height="120" alt="figure ${index}">
        <figcaption>${figureCaption(index)}</figcaption>
      </figure>
      <table>
        <thead>
          <tr><th>${tableHeader(index)}</th><th>VALUE</th></tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </section>`;
}

export function reportHtml(): string {
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
    font-size: 13px;
    line-height: 20px;
    color: rgb(25, 25, 25);
  }
  h1 { font-size: 22px; line-height: 30px; margin: 0 0 12px 0; }
  h2 { font-size: 16px; line-height: 24px; margin: 16px 0 8px 0; break-after: avoid; }
  p { margin: 0 0 8px 0; orphans: 2; widows: 2; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px 0; }
  th, td { border: 1px solid rgb(120, 120, 120); padding: 2px 5px; text-align: left; }
  thead th { background-color: rgb(235, 235, 240); }
  figure { margin: 8px 0; break-inside: avoid; }
  figcaption { font-size: 11px; color: rgb(90, 90, 90); }
</style>
</head>
<body>
  <div id="subject">
    <h1>Quarterly Report</h1>
${Array.from({ length: SECTION_COUNT }, (_, index) => section(index + 1)).join("\n")}
  </div>
</body>
</html>
`;
}
