/**
 * M1 exit-test fixture: a PDF containing one filled rectangle.
 *
 * Deliberately minimal — it exercises the object model, page tree, content
 * stream, compression and cross-reference machinery without depending on
 * fonts, which do not exist until M2.
 */

import { PdfDocument, type XrefStyle } from "@pkg/core/pdf/index.js";

/** Pinned so output is byte-identical across runs. */
export const FIXED_DATE = new Date("2024-01-01T00:00:00Z");

/** Letter portrait, in points. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

/** The rectangle, in PDF user space (origin bottom-left). */
export const RECT = { x: 100, y: 500, width: 400, height: 200 } as const;
export const RECT_COLOR = { r: 0.1, g: 0.35, b: 0.85 } as const;

export interface RectangleOptions {
  readonly xref?: XrefStyle;
  readonly objectStreams?: boolean;
}

export function buildRectanglePdf(options: RectangleOptions = {}): Uint8Array {
  const document = new PdfDocument({
    ...(options.xref === undefined ? {} : { xref: options.xref }),
    ...(options.objectStreams === undefined ? {} : { objectStreams: options.objectStreams }),
    info: {
      title: "M1 rectangle",
      creator: "@pkg/core test fixture",
      creationDate: FIXED_DATE,
    },
  });

  const page = document.addPage({ width: PAGE_WIDTH, height: PAGE_HEIGHT });

  page.content.scoped((stream) => {
    stream
      .setFillRgb(RECT_COLOR.r, RECT_COLOR.g, RECT_COLOR.b)
      .rect(RECT.x, RECT.y, RECT.width, RECT.height)
      .fill();
  });

  return document.toBytes();
}
