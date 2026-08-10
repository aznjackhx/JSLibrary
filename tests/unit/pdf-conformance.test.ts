/**
 * M1 exit test: emit a PDF containing one filled rectangle, and prove it is
 * valid to something other than ourselves.
 *
 * `qpdf --check` reads the cross-reference and object graph and complains about
 * anything inconsistent; pdf.js is the parser the visual regression harness
 * uses, so if it cannot read our output nothing downstream works either.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildRectanglePdf,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  RECT,
  RECT_COLOR,
  type RectangleOptions,
} from "../fixtures/rectangle.js";

/** Both cross-reference styles must survive external validation. */
const VARIANTS: ReadonlyArray<{ label: string; options: RectangleOptions }> = [
  { label: "xref stream + object streams", options: { xref: "stream", objectStreams: true } },
  { label: "xref stream, no object streams", options: { xref: "stream", objectStreams: false } },
  { label: "classic xref table", options: { xref: "table" } },
];

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
  workDir = mkdtempSync(join(tmpdir(), "pdf-conformance-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeFixture(label: string, options: RectangleOptions): string {
  const path = join(workDir, `${label.replaceAll(/[^a-z0-9]+/gi, "-")}.pdf`);
  writeFileSync(path, buildRectanglePdf(options));
  return path;
}

describe("qpdf --check", () => {
  it("is installed", () => {
    // In CI a missing qpdf is a broken pipeline, not a reason to skip the one
    // check that validates our output against an independent implementation.
    if (process.env["CI"] && !QPDF_AVAILABLE) {
      throw new Error("qpdf is required in CI but was not found on PATH");
    }
    expect(QPDF_AVAILABLE || !process.env["CI"]).toBe(true);
  });

  for (const { label, options } of VARIANTS) {
    it.skipIf(!QPDF_AVAILABLE)(`reports no errors: ${label}`, () => {
      const path = writeFixture(label, options);
      const output = execFileSync("qpdf", ["--check", path], { encoding: "utf8" });

      expect(output).toContain("No syntax or stream encoding errors found");
      expect(output).toMatch(/File is not encrypted/);
    });
  }

  it.skipIf(!QPDF_AVAILABLE)("reports the structural version it detects", () => {
    const path = writeFixture("version", { xref: "stream" });
    const output = execFileSync("qpdf", ["--check", path], { encoding: "utf8" });
    expect(output).toMatch(/PDF Version: 1\.7/);
  });
});

describe("pdf.js parsing", () => {
  for (const { label, options } of VARIANTS) {
    it(`parses the document and its page geometry: ${label}`, async () => {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

      const task = getDocument({
        data: buildRectanglePdf(options),
        // Nothing is fetched: the bytes are supplied directly and the document
        // embeds everything it needs.
        useSystemFonts: false,
      });
      const document = await task.promise;

      try {
        expect(document.numPages).toBe(1);

        const page = await document.getPage(1);
        expect(page.view).toEqual([0, 0, PAGE_WIDTH, PAGE_HEIGHT]);
        expect(page.rotate).toBe(0);
      } finally {
        await task.destroy();
      }
    });
  }

  it("exposes the rectangle as vector operators, not an image", async () => {
    const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const task = getDocument({
      data: buildRectanglePdf(),
      useSystemFonts: false,
    });
    const document = await task.promise;

    try {
      const page = await document.getPage(1);
      const operatorList = await page.getOperatorList();
      const operators: number[] = [...operatorList.fnArray];

      expect(operators).toContain(OPS.constructPath);
      expect(operators).toContain(OPS.setFillRGBColor);

      // Nothing rasterised: no image operator anywhere in the page.
      expect(operators).not.toContain(OPS.paintImageXObject);
      expect(operators).not.toContain(OPS.paintInlineImageXObject);

      const colorIndex = operators.indexOf(OPS.setFillRGBColor);
      const [color] = operatorList.argsArray[colorIndex] as unknown as [string];

      // pdf.js reports the fill as a CSS hex colour; ours are 0–1 components.
      const channel = (value: number): string =>
        Math.round(value * 255)
          .toString(16)
          .padStart(2, "0");
      expect(color).toBe(
        `#${channel(RECT_COLOR.r)}${channel(RECT_COLOR.g)}${channel(RECT_COLOR.b)}`,
      );
    } finally {
      await task.destroy();
    }
  });

  it("reads back the rectangle at the coordinates we wrote", async () => {
    const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const task = getDocument({
      data: buildRectanglePdf(),
      useSystemFonts: false,
    });
    const document = await task.promise;

    try {
      const page = await document.getPage(1);
      const operatorList = await page.getOperatorList();
      const pathIndex = [...operatorList.fnArray].indexOf(OPS.constructPath);
      const args = operatorList.argsArray[pathIndex] as unknown as [
        number,
        unknown,
        ArrayLike<number>,
      ];

      // Third argument is the path's bounding box: [x0, y0, x1, y1] in user
      // space, which for a single rectangle is the rectangle itself.
      const boundingBox = Array.from(args[2]);
      expect(boundingBox).toEqual([
        RECT.x,
        RECT.y,
        RECT.x + RECT.width,
        RECT.y + RECT.height,
      ]);
    } finally {
      await task.destroy();
    }
  });
});

describe("output size", () => {
  it("stays small — compression and object streams are doing their job", () => {
    const compact = buildRectanglePdf({ xref: "stream", objectStreams: true });
    const classic = buildRectanglePdf({ xref: "table" });

    expect(compact.length).toBeLessThan(1200);
    expect(compact.length).toBeLessThan(classic.length);
  });
});
