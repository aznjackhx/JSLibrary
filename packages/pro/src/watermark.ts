/**
 * The unlicensed watermark.
 *
 * Deliberately mild. The brief's rule is that unlicensed use warns and marks
 * the output — never throws, never silently corrupts. So this draws one line of
 * grey text in the bottom margin of each page and touches nothing else: the
 * document still renders, still extracts, still passes a validator, and the
 * mark is trivially removable by anyone determined to remove it. That is
 * expected. The enforcement is the licence, not this.
 */

import {
  dict,
  name,
  textString,
  type PdfDocument,
  type PdfLiteralString,
  type PdfPage,
} from "@pkg/core/pdf";

/** Text drawn on each page of unlicensed output. */
export const WATERMARK_TEXT = "Unlicensed @pkg/pro build";

/**
 * A width estimate for the mark, in points.
 *
 * Helvetica is one of the fourteen fonts every PDF reader ships, so the mark
 * needs no embedded font of its own — which matters, because a watermark that
 * dragged a font subset into the file would change the output it is marking.
 * Average character width for Helvetica at this size is close enough to place
 * a single short line.
 */
function estimateWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.5;
}

/** A Latin-1 literal string; the mark is ASCII by construction. */
function literal(text: string): PdfLiteralString {
  return textString(text) as PdfLiteralString;
}

export interface WatermarkOptions {
  readonly text?: string;
  readonly fontSize?: number;
}

/**
 * Stamp every page of a document.
 *
 * Uses the standard Helvetica rather than an embedded subset. Note that this
 * makes watermarked output ineligible for PDF/A, which requires every font to
 * be embedded — so a PDF/A render that is unlicensed cannot both carry the mark
 * and claim conformance. The caller decides which; see `pdfA2b`.
 */
export function stampWatermark(
  document: PdfDocument,
  options: WatermarkOptions = {},
): number {
  const text = options.text ?? WATERMARK_TEXT;
  const fontSize = options.fontSize ?? 8;

  const font = document.add(
    dict({
      Type: name("Font"),
      Subtype: name("Type1"),
      BaseFont: name("Helvetica"),
    }),
  );

  let stamped = 0;

  for (const page of document.pages as readonly PdfPage[]) {
    const resourceName = page.resources.register("Font", font);
    const x = Math.max((page.width - estimateWidth(text, fontSize)) / 2, 4);

    page.content.scoped((stream) => {
      stream.setFillGray(0.6);
      stream.text((run) => {
        run.setFont(resourceName, fontSize).moveText(x, 12).showText(literal(text));
      });
    });

    stamped += 1;
  }

  return stamped;
}
