/**
 * Slicing a measured column into pages.
 *
 * This is the plumbing, not the policy. Bands are cut at fixed page-height
 * intervals; nothing yet looks at where the content would prefer to break.
 * Choosing break positions — so a band never lands mid-line, mid-image or
 * inside a block marked `break-inside: avoid` — is the next step, and it
 * changes only how `paginate` picks its boundaries.
 *
 * What is already settled here is the part that has to be right regardless of
 * policy: every line belongs to exactly one page, boxes that span a boundary
 * are clipped rather than bled, and content is neither lost nor duplicated.
 */

import type { MeasuredDocument } from "../measure/types.js";
import type { PdfDocument } from "../pdf/document.js";
import type { PageGeometry } from "../page/geometry.js";
import { ptToPx } from "../units.js";
import type { EmissionContext, PageBand } from "./emit.js";
import { paintPage } from "./emit.js";

/** One page's slice of the measured column. */
export interface PageSlice extends PageBand {
  /** Zero-based page index. */
  readonly index: number;
}

/**
 * Cut the measured column into page-sized bands.
 *
 * A document shorter than one page still gets a page — an empty document is a
 * single blank sheet, not a PDF with no pages, which is invalid.
 */
export function paginate(contentHeightPx: number, pageHeightPx: number): PageSlice[] {
  if (!(pageHeightPx > 0)) {
    throw new RangeError(`Page content height must be positive, received ${pageHeightPx}`);
  }

  const pageCount = Math.max(1, Math.ceil(contentHeightPx / pageHeightPx));
  const slices: PageSlice[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    slices.push({
      index,
      top: index * pageHeightPx,
      bottom: (index + 1) * pageHeightPx,
    });
  }

  return slices;
}

/** Paint a measured document across as many pages as it needs. */
export function paintPagedDocument(
  pdf: PdfDocument,
  measured: MeasuredDocument,
  context: EmissionContext,
  geometry: PageGeometry,
): PageSlice[] {
  const pageHeightPx = ptToPx(geometry.content.height);
  const slices = paginate(measured.contentHeight, pageHeightPx);

  for (const slice of slices) {
    const page = pdf.addPage({
      width: geometry.size.width,
      height: geometry.size.height,
    });
    paintPage(page, measured, context, geometry.content, slice);
  }

  return slices;
}
