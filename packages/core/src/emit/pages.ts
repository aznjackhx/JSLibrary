/**
 * Painting a measured column across pages.
 *
 * Where the pages end is decided by the fragment module; this only paints the
 * slices it returns.
 */

import { buildFragmentModel } from "../fragment/atoms.js";
import { paginate, type PageSlice } from "../fragment/paginate.js";
import type { MeasuredDocument } from "../measure/types.js";
import type { PdfDocument } from "../pdf/document.js";
import type { PageGeometry } from "../page/geometry.js";
import { ptToPx } from "../units.js";
import type { EmissionContext } from "./emit.js";
import { paintPage } from "./emit.js";

export type { PageSlice } from "../fragment/paginate.js";

/** Paint a measured document across as many pages as it needs. */
export function paintPagedDocument(
  pdf: PdfDocument,
  measured: MeasuredDocument,
  context: EmissionContext,
  geometry: PageGeometry,
): PageSlice[] {
  const pageHeight = ptToPx(geometry.content.height);
  const model = buildFragmentModel(measured.root);
  const slices = paginate(model, { pageHeight, contentHeight: measured.contentHeight });

  for (const slice of slices) {
    const page = pdf.addPage({
      width: geometry.size.width,
      height: geometry.size.height,
    });
    paintPage(page, measured, context, geometry.content, slice);
  }

  return slices;
}
