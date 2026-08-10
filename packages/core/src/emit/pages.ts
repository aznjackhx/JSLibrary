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
import { stringsForPage, type StringAssignment } from "../page/string-set.js";
import { ptToPx } from "../units.js";
import type { EmissionContext } from "./emit.js";
import { paintPage } from "./emit.js";
import { paintMarginBoxes } from "./margin-boxes.js";

export type { PageSlice } from "../fragment/paginate.js";

export interface PagedOptions {
  /**
   * Geometry for a given page index. `blank` is true for a page generated to
   * satisfy a side-specific break, which `@page :blank` selects.
   */
  readonly contextFor: (pageIndex: number, blank: boolean) => PageContext;
  readonly stranding?: StrandingDefaults;
  /** Named-string assignments from measurement, in document order. */
  readonly strings?: readonly StringAssignment[];
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
    pageHeight: (pageIndex) => ptToPx(options.contextFor(pageIndex, false).content.height),
    contentHeight: measured.contentHeight,
    tables,
  });

  for (const slice of slices) {
    const page$ = options.contextFor(slice.index, slice.blank);
    const page = pdf.addPage({ width: page$.size.width, height: page$.size.height });

    const pageHeight = ptToPx(page$.content.height);

    // A page beginning inside a table repeats that table's header at the top
    // and its footer at the foot.
    // A blank page holds no rows, so it repeats no table header either.
    const header = (slice.blank ? [] : headerRepeatAt(tables, slice.top))
      .map((table) => table.header?.node)
      .filter((node): node is NonNullable<typeof node> => node !== undefined);
    const footer = (slice.blank ? [] : footerRepeatAt(tables, slice.top, pageHeight))
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
        facts: {
          page: slice.index + 1,
          pages: slices.length,
          // A page shows the first assignment falling on it, or the value in
          // effect when it began — which is what carries a section heading
          // onto its continuation pages.
          strings: stringsForPage(options.strings ?? [], slice.top, slice.bottom),
        },
        font,
        subset: context.subsetFor(font),
        resourceName: context.resourceNameFor(page, font),
      });
    }
  }

  return slices;
}
