/**
 * Painting a measured column across pages.
 *
 * Where the pages end is decided by the fragment module; this only paints the
 * slices it returns.
 */

import { buildFragmentModel } from "../fragment/atoms.js";
import { paginate, type PageSlice } from "../fragment/paginate.js";
import {
  collectRepeatingTables,
  footerRepeatAt,
  headerRepeatAt,
} from "../fragment/tables.js";
import type { MeasuredDocument } from "../measure/types.js";
import type { PdfDocument } from "../pdf/document.js";
import type { StrandingDefaults } from "../fragment/stranding.js";
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
  stranding: StrandingDefaults = {},
): PageSlice[] {
  const pageHeight = ptToPx(geometry.content.height);
  const model = buildFragmentModel(measured.root, stranding);
  const tables = collectRepeatingTables(measured.root);

  const slices = paginate(model, {
    pageHeight,
    contentHeight: measured.contentHeight,
    tables,
  });

  for (const slice of slices) {
    const page = pdf.addPage({
      width: geometry.size.width,
      height: geometry.size.height,
    });

    // A page beginning inside a table repeats that table's header at the top
    // and its footer at the foot.
    const header = headerRepeatAt(tables, slice.top)
      .map((table) => table.header?.node)
      .filter((node): node is NonNullable<typeof node> => node !== undefined);
    const footer = footerRepeatAt(tables, slice.top, pageHeight)
      .map((table) => table.footer?.node)
      .filter((node): node is NonNullable<typeof node> => node !== undefined);

    paintPage(page, measured, context, geometry.content, slice, {
      header,
      headerHeight: slice.reservedTop,
      footer,
      footerHeight: slice.reservedBottom,
    });
  }

  return slices;
}
