/**
 * Painting a measured column across pages.
 *
 * Page geometry can differ from page to page — `@page :first` may set its own
 * margins, `:left` and `:right` may mirror theirs — so each page resolves its
 * own context rather than sharing one.
 */

import { buildFragmentModel } from "../fragment/atoms.js";
import { paginate, type PageSlice } from "../fragment/paginate.js";
import type { StrandingDefaults } from "../fragment/stranding.js";
import {
  collectRepeatingTables,
  footerRepeatAt,
  headerRepeatAt,
} from "../fragment/tables.js";
import type { MeasuredDocument } from "../measure/types.js";
import type { PdfDocument } from "../pdf/document.js";
import type { PageContext } from "../page/context.js";
import { ptToPx } from "../units.js";
import type { EmissionContext } from "./emit.js";
import { paintPage } from "./emit.js";
import { paintMarginBoxes } from "./margin-boxes.js";

export type { PageSlice } from "../fragment/paginate.js";

export interface PagedOptions {
  /** Geometry for a given page index. */
  readonly contextFor: (pageIndex: number) => PageContext;
  readonly stranding?: StrandingDefaults;
}

/** Paint a measured document across as many pages as it needs. */
export function paintPagedDocument(
  pdf: PdfDocument,
  measured: MeasuredDocument,
  context: EmissionContext,
  options: PagedOptions,
): PageSlice[] {
  const model = buildFragmentModel(measured.root, options.stranding ?? {});
  const tables = collectRepeatingTables(measured.root);

  const slices = paginate(model, {
    pageHeight: (pageIndex) => ptToPx(options.contextFor(pageIndex).content.height),
    contentHeight: measured.contentHeight,
    tables,
  });

  for (const slice of slices) {
    const page$ = options.contextFor(slice.index);
    const page = pdf.addPage({ width: page$.size.width, height: page$.size.height });

    const pageHeight = ptToPx(page$.content.height);

    // A page beginning inside a table repeats that table's header at the top
    // and its footer at the foot.
    const header = headerRepeatAt(tables, slice.top)
      .map((table) => table.header?.node)
      .filter((node): node is NonNullable<typeof node> => node !== undefined);
    const footer = footerRepeatAt(tables, slice.top, pageHeight)
      .map((table) => table.footer?.node)
      .filter((node): node is NonNullable<typeof node> => node !== undefined);

    paintPage(page, measured, context, page$.content, slice, {
      header,
      headerHeight: slice.reservedTop,
      footer,
      footerHeight: slice.reservedBottom,
    });

    // Margin boxes sit outside the content area and are painted after it, so
    // nothing in the body can overlap a running header.
    if (page$.marginBoxes.size > 0) {
      const font = context.marginBoxFont();
      paintMarginBoxes(page.content, {
        page: page$,
        facts: { page: slice.index + 1, pages: slices.length },
        font,
        subset: context.subsetFor(font),
        resourceName: context.resourceNameFor(page, font),
      });
    }
  }

  return slices;
}
