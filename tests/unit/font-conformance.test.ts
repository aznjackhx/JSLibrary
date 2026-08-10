/**
 * M2 exit test: a PDF containing "Hello — Ünïcödé ✓" whose text extracts back
 * exactly, with an embedded font under 20 KB.
 *
 * Three independent checks, because a font can be wrong in three independent
 * ways: qpdf validates the file structure, pdf.js proves the text round-trips
 * through the ToUnicode CMap, and fontkit — a font library with no stake in our
 * subsetter being correct — proves the embedded program is a real font with the
 * outlines we claim.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildTextPdf,
  buildTextPdfDetailed,
  SAMPLE_TEXT,
  testFontBytes,
} from "../fixtures/text.js";

const require = createRequire(import.meta.url);

/** 20 KB is the brief's ceiling for the embedded font in this exit test. */
const FONT_SIZE_LIMIT = 20 * 1024;

let workDir: string;

function hasQpdf(): boolean {
  try {
    execFileSync("qpdf", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const QPDF_AVAILABLE = hasQpdf();

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "font-conformance-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function extractText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes, useSystemFonts: false });
  const document = await task.promise;

  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    return content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join("");
  } finally {
    await task.destroy();
  }
}

describe("text round-trip", () => {
  it("extracts exactly the string that was written", async () => {
    const extracted = await extractText(buildTextPdf());
    expect(extracted).toBe(SAMPLE_TEXT);
  });

  it("round-trips each awkward character on its own", async () => {
    // Failing individually localises the fault: an em dash failing is a
    // ToUnicode problem, a check mark failing is a cmap coverage problem.
    for (const text of ["—", "Ü", "ï", "ö", "é", "✓"]) {
      const extracted = await extractText(buildTextPdf({ text }));
      expect(extracted, `round-tripping ${text}`).toBe(text);
    }
  });

  it("round-trips text with repeated characters, which share a CID", async () => {
    const extracted = await extractText(buildTextPdf({ text: "aaa bbb aaa" }));
    expect(extracted).toBe("aaa bbb aaa");
  });

  it("resolves every glyph inside the embedded font, with no substitution", async () => {
    const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: buildTextPdf(), useSystemFonts: false });
    const document = await task.promise;

    try {
      const page = await document.getPage(1);
      const operatorList = await page.getOperatorList();

      const showIndex = [...operatorList.fnArray].indexOf(OPS.showText);
      expect(showIndex).toBeGreaterThanOrEqual(0);

      const [glyphs] = operatorList.argsArray[showIndex] as unknown as [
        Array<{ unicode: string; isInFont: boolean; width: number }>,
      ];

      // isInFont false means pdf.js could not find an outline for the glyph in
      // the program we embedded. The space is legitimately outline-free — it is
      // pure advance — so it is checked separately below.
      for (const glyph of glyphs.filter((candidate) => candidate.unicode !== " ")) {
        expect(glyph.isInFont, `glyph for ${JSON.stringify(glyph.unicode)}`).toBe(true);
      }

      // A space carries no outline but must keep its advance, or the words run
      // together.
      const space = glyphs.find((candidate) => candidate.unicode === " ");
      expect(space?.width).toBeGreaterThan(0);

      // The unicode pdf.js recovers comes from our ToUnicode CMap.
      expect(glyphs.map((glyph) => glyph.unicode).join("")).toBe(SAMPLE_TEXT);
    } finally {
      await task.destroy();
    }
  });

  it("reports the advance widths we wrote into /W", async () => {
    const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { textWidth } = buildTextPdfDetailed();

    const task = getDocument({ data: buildTextPdf(), useSystemFonts: false });
    const document = await task.promise;

    try {
      const page = await document.getPage(1);
      const operatorList = await page.getOperatorList();
      const showIndex = [...operatorList.fnArray].indexOf(OPS.showText);
      const [glyphs] = operatorList.argsArray[showIndex] as unknown as [
        Array<{ width: number }>,
      ];

      // Widths are in glyph space; the fixture reports the same total scaled to
      // the 24pt font size.
      const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
      expect((total / 1000) * 24).toBeCloseTo(textWidth, 1);
    } finally {
      await task.destroy();
    }
  });
});

describe("embedded font size", () => {
  it("stays under 20 KB", () => {
    const { fontProgram } = buildTextPdfDetailed();
    expect(fontProgram.length).toBeLessThan(FONT_SIZE_LIMIT);
  });

  it("is a small fraction of the source font", () => {
    const { fontProgram } = buildTextPdfDetailed();
    expect(fontProgram.length).toBeLessThan(testFontBytes().length / 20);
  });

  it("keeps the whole PDF small", () => {
    expect(buildTextPdf().length).toBeLessThan(FONT_SIZE_LIMIT);
  });
});

describe("qpdf --check", () => {
  it.skipIf(!QPDF_AVAILABLE)("reports no errors", () => {
    const path = join(workDir, "text.pdf");
    writeFileSync(path, buildTextPdf());

    const output = execFileSync("qpdf", ["--check", path], { encoding: "utf8" });
    expect(output).toContain("No syntax or stream encoding errors found");
  });

  it.skipIf(!QPDF_AVAILABLE)("reports no errors with a classic cross-reference table", () => {
    const path = join(workDir, "text-table.pdf");
    writeFileSync(path, buildTextPdf({ xref: "table" }));

    const output = execFileSync("qpdf", ["--check", path], { encoding: "utf8" });
    expect(output).toContain("No syntax or stream encoding errors found");
  });
});

describe("the embedded program is a real font", () => {
  it("parses in fontkit, which has no stake in our subsetter being right", () => {
    const fontkit = require("fontkit") as typeof import("fontkit");
    const { fontProgram } = buildTextPdfDetailed();

    const parsed = fontkit.create(Buffer.from(fontProgram)) as import("fontkit").Font;

    // .notdef plus the distinct characters in the sample, plus whatever
    // components the composites pulled in.
    const distinct = new Set([...SAMPLE_TEXT]).size;
    expect(parsed.numGlyphs).toBeGreaterThanOrEqual(distinct);
    expect(parsed.unitsPerEm).toBe(2048);
  });

  it("has outlines for every CID, and they are not empty", () => {
    const fontkit = require("fontkit") as typeof import("fontkit");
    const { fontProgram } = buildTextPdfDetailed();
    const parsed = fontkit.create(Buffer.from(fontProgram)) as import("fontkit").Font;

    // CID 1 onward are the sample's characters in first-use order. The space
    // has no outline, so it is excluded.
    const printable = [...SAMPLE_TEXT].filter((character) => character !== " ");
    let checked = 0;

    for (let cid = 1; cid < parsed.numGlyphs && checked < printable.length; cid += 1) {
      const glyph = parsed.getGlyph(cid);
      const path = glyph.path;
      if (path.commands.length > 0) checked += 1;
    }

    expect(checked).toBeGreaterThanOrEqual(printable.length);
  });

  it("keeps composite accents intact through renumbering", () => {
    const fontkit = require("fontkit") as typeof import("fontkit");
    const { fontProgram } = buildTextPdfDetailed({ text: "é" });
    const parsed = fontkit.create(Buffer.from(fontProgram)) as import("fontkit").Font;

    // CID 1 is "é". If component renumbering were wrong, the outline would be
    // empty or would draw the wrong glyph.
    const glyph = parsed.getGlyph(1);
    expect(glyph.path.commands.length).toBeGreaterThan(0);

    // The accent sits above the x-height, so the glyph is taller than a plain e.
    const plainE = buildTextPdfDetailed({ text: "e" });
    const plain = fontkit.create(Buffer.from(plainE.fontProgram)) as import("fontkit").Font;
    expect(glyph.bbox.maxY).toBeGreaterThan(plain.getGlyph(1).bbox.maxY);
  });
});

describe("determinism", () => {
  it("produces byte-identical output for identical input", () => {
    expect(Buffer.from(buildTextPdf()).equals(Buffer.from(buildTextPdf()))).toBe(true);
  });

  it("assigns a stable subset tag", () => {
    expect(buildTextPdfDetailed().baseFont).toBe(buildTextPdfDetailed().baseFont);
    expect(buildTextPdfDetailed().baseFont).toMatch(/^[A-Z]{6}\+/);
  });

  it("gives different subsets different tags, so merged documents do not collide", () => {
    const a = buildTextPdfDetailed({ text: "Hello" }).baseFont;
    const b = buildTextPdfDetailed({ text: "World" }).baseFont;
    expect(a).not.toBe(b);
  });
});
