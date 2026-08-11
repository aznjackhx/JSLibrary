/**
 * M5.7 fixture: a table long enough to span many pages.
 *
 * Every row is identifiable, so a test can prove rows are neither lost nor
 * duplicated, and the header carries a distinctive phrase so its repetition can
 * be counted per page.
 */

import { renderFontDataUrl } from "./render-page.js";

export const CONTENT_WIDTH_PX = 720;

/** Enough rows to span several pages. */
export const ROW_COUNT = 140;

export const HEADER_PHRASE = "ITEM CODE";
export const FOOTER_PHRASE = "RUNNING TOTAL";

export const rowLabel = (index: number): string => `Row ${index} data.`;

export function tablePageHtml(options: { footer?: boolean } = {}): string {
  const rows = Array.from(
    { length: ROW_COUNT },
    (_, index) =>
      `        <tr><td>${rowLabel(index + 1)}</td><td>${(index + 1) * 10}.00</td></tr>`,
  ).join("\n");

  const foot = options.footer
    ? `        <tfoot>
          <tr><th>${FOOTER_PHRASE}</th><th>—</th></tr>
        </tfoot>`
    : "";

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
    color: rgb(20, 20, 20);
  }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid rgb(90, 90, 90); padding: 2px 6px; text-align: left; }
  thead th { background-color: rgb(230, 230, 240); }
  p { margin: 0 0 10px 0; }
</style>
</head>
<body>
  <div id="subject">
    <p>Lead-in paragraph before the table.</p>
    <table id="ledger">
      <thead>
        <tr><th>${HEADER_PHRASE}</th><th>AMOUNT</th></tr>
      </thead>
${foot}
      <tbody>
${rows}
      </tbody>
    </table>
    <p>Closing paragraph after the table.</p>
  </div>
</body>
</html>`;
}

/** Lines of the long note inside the oversized row, each identifiable. */
export const NOTE_LINES = 90;
export const noteLine = (index: number): string => `Note line ${index} of the schedule.`;

/**
 * A table whose middle row is taller than a page.
 *
 * A financial table with a long note in one cell hits this immediately, and
 * until the paginator learned to divide such a row the note printed its first
 * page and nothing after it — the rest was clipped away with no indication
 * that anything was missing.
 */
export function tallRowTableHtml(): string {
  const note = Array.from(
    { length: NOTE_LINES },
    (_, index) => `${noteLine(index + 1)}`,
  ).join("<br>\n");

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
    color: rgb(20, 20, 20);
  }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid rgb(90, 90, 90); padding: 2px 6px; text-align: left;
           vertical-align: top; }
  thead th { background-color: rgb(230, 230, 240); }
  /* The authored intent that creates the problem: keep each row together.
     Every row but one can be, and that one is taller than the page. */
  tr { break-inside: avoid; }
</style>
</head>
<body>
  <div id="subject">
    <table id="schedule">
      <thead>
        <tr><th>${HEADER_PHRASE}</th><th>AMOUNT</th></tr>
      </thead>
      <tbody>
        <tr><td>${rowLabel(1)}</td><td>10.00</td></tr>
        <tr><td>${note}</td><td>20.00</td></tr>
        <tr><td>${rowLabel(3)}</td><td>30.00</td></tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;
}
