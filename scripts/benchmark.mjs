/**
 * Timings on documents shaped like the ones people actually have.
 *
 * The brief's budget — fifty pages in under five seconds on a mid-range laptop
 * — was only ever measured against a fixture of repeated identical paragraphs,
 * which is the easiest possible input: one font, one text style, no tables, no
 * vector art. These are harder in the ways real documents are harder.
 *
 *   node scripts/benchmark.mjs
 *
 * Reports the median of a few runs per document, since a single run on a
 * shared runner says more about the runner than the renderer. Not a test: it
 * asserts nothing and is never run in CI, because a timing threshold on
 * someone else's hardware fails for reasons that have nothing to do with the
 * change under review.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const BUNDLE = resolve(ROOT, "packages/core/dist/index.global.js");
const FONT = resolve(ROOT, "tests/fixtures/fonts/DejaVuSansMono.ttf");

const RUNS = 5;

const fontBytes = [...new Uint8Array(readFileSync(FONT))];
const fontDataUrl = `data:font/ttf;base64,${readFileSync(FONT).toString("base64")}`;

function page(body, css = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "B"; src: url("${fontDataUrl}") format("truetype"); }
@page { size: A4; margin: 18mm; }
html, body { margin: 0; padding: 0; background: #fff; }
#subject { width: 174mm; font-family: "B", monospace; font-size: 10pt; color: #18181b; }
${css}
</style></head><body><div id="subject">${body}</div></body></html>`;
}

const SENTENCE =
  "Revenue for the period rose against a comparable quarter, with the largest " +
  "single contribution coming from renewals rather than new business.";

/** A chart of the shape a dashboard repeats. */
function chart(index) {
  const bars = Array.from(
    { length: 6 },
    (_, bar) =>
      `<rect x="${12 + bar * 14}" y="${20 + ((bar + index) % 5) * 8}" width="10" ` +
      `height="${60 - ((bar + index) % 5) * 8}" fill="rgb(30,64,175)"/>`,
  ).join("");

  return `<svg width="150" height="90" viewBox="0 0 100 90">
    <line x1="10" y1="80" x2="98" y2="80" stroke="rgb(212,212,216)" stroke-width="0.7"/>
    ${bars}
    <text x="54" y="88" font-size="5" text-anchor="middle" fill="rgb(24,24,27)">Series ${index}</text>
  </svg>`;
}

const DOCUMENTS = [
  {
    name: "long report (~200 pages)",
    html: page(
      Array.from(
        { length: 1200 },
        (_, index) => `<p>${index + 1}. ${SENTENCE} ${SENTENCE}</p>`,
      ).join("\n"),
      "p { margin: 0 0 11px; text-align: justify; }",
    ),
  },
  {
    name: "5,000-row table",
    html: page(
      `<table><thead><tr><th>Code</th><th>Description</th><th>Amount</th></tr></thead><tbody>${Array.from(
        { length: 5000 },
        (_, index) =>
          `<tr><td>R-${index + 1}</td><td>Line item ${index + 1}</td><td>${((index + 1) * 7.5).toFixed(2)}</td></tr>`,
      ).join("")}</tbody></table>`,
      `table { width: 100%; border-collapse: collapse; }
       th, td { border-bottom: 1px solid rgb(228,228,231); padding: 3px 6px;
                font-size: 8pt; text-align: left; }`,
    ),
  },
  {
    name: "fifty SVG charts on a page",
    html: page(
      `<div class="grid">${Array.from({ length: 50 }, (_, index) => chart(index + 1)).join("")}</div>`,
      ".grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }",
    ),
  },
];

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const browser = await chromium.launch({
  // Without this, usedJSHeapSize is bucketed and updated lazily: it reports
  // the same 13 MB for a two-page document and a hundred-page one, which is
  // the baseline heap rather than anything the render did.
  args: ["--enable-precise-memory-info"],
  ...(process.env["PW_CHROMIUM_EXECUTABLE"]
    ? { executablePath: process.env["PW_CHROMIUM_EXECUTABLE"] }
    : {}),
});

try {
  const rows = [];

  for (const document_ of DOCUMENTS) {
    const tab = await browser.newPage();
    await tab.setContent(document_.html, { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);
    await tab.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });

    const samples = [];
    let pages = 0;
    let bytes = 0;
    let peakHeapMb = 0;

    for (let run = 0; run < RUNS; run += 1) {
      const result = await tab.evaluate(
        async ({ font }) => {
          // Chromium-only, and that is fine for a number meant to answer
          // "where does this fall over" rather than to be compared across
          // engines. Sampled during the render, not after: the measured tree
          // and the byte buffer are both released by the time it returns, so
          // reading afterwards reports the floor rather than the peak.
          const heap = () => performance.memory?.usedJSHeapSize ?? 0;
          const baseline = heap();
          let peak = baseline;
          const poll = setInterval(() => {
            peak = Math.max(peak, heap());
          }, 25);

          const started = performance.now();
          try {
            const pdf = await window.PkgCore.render(document.querySelector("#subject"), {
              metadata: { creationDate: new Date("2024-01-01T00:00:00Z") },
              fonts: [{ family: "B", data: new Uint8Array(font) }],
            });
            peak = Math.max(peak, heap());
            return { ms: performance.now() - started, bytes: pdf.byteLength, peak: peak - baseline };
          } finally {
            clearInterval(poll);
          }
        },
        { font: fontBytes },
      );
      samples.push(result.ms);
      bytes = result.bytes;
      peakHeapMb = Math.max(peakHeapMb, Math.round(result.peak / 1024 / 1024));
    }

    // Page count from the output itself, so each row says what was actually
    // rendered rather than what the input was meant to produce. Read with a
    // PDF reader, not a regex: the page tree lives in compressed object
    // streams, so searching the bytes finds nothing and reports zero.
    const bytes_ = await tab.evaluate(
      async ({ font }) => {
        const pdf = await window.PkgCore.render(document.querySelector("#subject"), {
          metadata: { creationDate: new Date("2024-01-01T00:00:00Z") },
          fonts: [{ family: "B", data: new Uint8Array(font) }],
        });
        return [...pdf];
      },
      { font: fontBytes },
    );

    const task = getDocument({ data: new Uint8Array(bytes_), useSystemFonts: false });
    const rendered = await task.promise;
    pages = rendered.numPages;
    await task.destroy();

    await tab.close();

    rows.push({
      document: document_.name,
      pages,
      "median ms": Math.round(median(samples)),
      "ms/page": pages > 0 ? Math.round(median(samples) / pages) : "—",
      "KB": Math.round(bytes / 1024),
      "heap MB over baseline": peakHeapMb,
    });
  }

  console.table(rows);
  console.log(`median of ${RUNS} runs; page counts read back from the output`);
} finally {
  await browser.close();
}
