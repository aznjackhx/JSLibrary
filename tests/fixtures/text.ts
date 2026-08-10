/**
 * M2 exit-test fixture: a PDF containing "Hello — Ünïcödé ✓" set in a subset,
 * embedded font.
 *
 * The string is chosen to be awkward on purpose. The em dash is outside Latin-1
 * as PDF encodes it, the accented characters are composite glyphs whose
 * components must be pulled into the subset, and the check mark sits well
 * outside the BMP-adjacent range most fonts bother with.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { encodeCids, embedFontSubset } from "@pkg/core/fonts/index.js";
import { Font } from "@pkg/core/fonts/font.js";
import { PdfDocument, type XrefStyle } from "@pkg/core/pdf/index.js";

export const SAMPLE_TEXT = "Hello — Ünïcödé ✓";

/** Pinned so output is byte-identical across runs. */
export const FIXED_DATE = new Date("2024-01-01T00:00:00Z");

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const FONT_SIZE = 24;
export const TEXT_X = 72;
export const TEXT_Y = 700;

const FONT_PATH = fileURLToPath(new URL("./fonts/DejaVuSansMono.ttf", import.meta.url));

let cachedFontBytes: Uint8Array | undefined;

export function testFontBytes(): Uint8Array {
  cachedFontBytes ??= new Uint8Array(readFileSync(FONT_PATH));
  return cachedFontBytes;
}

export interface TextPdfOptions {
  readonly text?: string;
  readonly xref?: XrefStyle;
  readonly keepHinting?: boolean;
}

export interface TextPdfResult {
  readonly bytes: Uint8Array;
  /** The embedded font program, uncompressed. */
  readonly fontProgram: Uint8Array;
  readonly baseFont: string;
  /** Advance width of the whole string, in PDF glyph space. */
  readonly textWidth: number;
}

export function buildTextPdfDetailed(options: TextPdfOptions = {}): TextPdfResult {
  const text = options.text ?? SAMPLE_TEXT;

  const font = Font.parse(testFontBytes());
  const subset = font.createSubset(
    options.keepHinting === undefined ? {} : { keepHinting: options.keepHinting },
  );

  const glyphs = subset.useText(text);
  const built = subset.build();

  const document = new PdfDocument({
    ...(options.xref === undefined ? {} : { xref: options.xref }),
    info: {
      title: "M2 embedded text",
      creator: "@pkg/core test fixture",
      creationDate: FIXED_DATE,
    },
  });

  const embedded = embedFontSubset(document, font, built);

  const page = document.addPage({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  const resourceName = page.resources.register("Font", embedded.ref);

  page.content.text((stream) => {
    stream
      .setFont(resourceName, FONT_SIZE)
      .moveText(TEXT_X, TEXT_Y)
      .showText(encodeCids(glyphs.map((glyph) => glyph.cid)));
  });

  const textWidth = glyphs.reduce((total, glyph) => total + glyph.width, 0);

  return {
    bytes: document.toBytes(),
    fontProgram: built.data,
    baseFont: embedded.baseFont,
    textWidth: (textWidth / 1000) * FONT_SIZE,
  };
}

export function buildTextPdf(options: TextPdfOptions = {}): Uint8Array {
  return buildTextPdfDetailed(options).bytes;
}
