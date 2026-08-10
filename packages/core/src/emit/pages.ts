/**
 * Painting a measured column across pages.
 *
 * Page geometry can differ from page to page — `@page :first` may set its own
 * margins, `:left` and `:right` may mirror theirs — so each page resolves its
 * own context rather than sharing one.
 *
 * Pages are all created before any is painted. A link on page one may point at
 * an anchor on page nine, and a destination has to name the page object it
 * lands on, so every page needs an object number before the first annotation
 * is built.
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
import type { PdfDocument, PdfPage } from "../pdf/document.js";
import type { PdfValue } from "../pdf/objects.js";
import type { PageContext } from "../page/context.js";
import { stringsForPage, type StringAssignment } from "../page/string-set.js";
import { ptToPx } from "../units.js";
import type { EmissionContext } from "./emit.js";
import { paintPage } from "./emit.js";
import { collectAnchors, collectLinks, destination, linkAnnotations } from "./links.js";
import { paintMarginBoxes } from "./margin-boxes.js";
import { PageTransform } from "./transform.js";

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
  /** Emit link annotations and in-document destinations. Default true. */
  readonly links?: boolean;
}

/** What a paginated document produced, for stages that run after painting. */
export interface PagedResult {
  readonly slices: readonly PageSlice[];
  readonly pages: readonly PdfPage[];
  /** Destination for each anchor id that fell on a page. */
  readonly destinations: ReadonlyMap<string, PdfValue[]>;
  /** Where a given y in the measured column landed. */
  readonly locate: (y: number) => { page: PdfPage; index: number } | undefined;
  /** The transform a page painted its content through. */
  readonly transformFor: (pageIndex: number) => PageTransform;
}

/** Paint a measured document across as many pages as it needs. */
export function paintPagedDocument(
  pdf: PdfDocument,
  measured: MeasuredDocument,
  context: EmissionContext,
  options: PagedOptions,
): PagedResult {
  const model = buildFragmentModel(measured.root, options.stranding ?? {});
  const tables = collectRepeatingTables(measured.root);

  const slices = paginate(model, {
    pageHeight: (pageIndex) => ptToPx(options.contextFor(pageIndex, false).content.height),
    contentHeight: measured.contentHeight,
    tables,
  });

  const contexts = slices.map((slice) => options.contextFor(slice.index, slice.blank));
  const pages = contexts.map((page$) =>
    pdf.addPage({ width: page$.size.width, height: page$.size.height }),
  );

  const transformFor = (index: number): PageTransform =>
    new PageTransform({
      content: (contexts[index] as PageContext).content,
      scrollY: (slices[index] as PageSlice).top,
      insetTop: (slices[index] as PageSlice).reservedTop,
    });

  const locate = (y: number): { page: PdfPage; index: number } | undefined => {
    let lastContent: number | undefined;

    for (const [index, slice] of slices.entries()) {
      // A generated page shows no content, so nothing can land on it.
      if (slice.blank) continue;
      lastContent = index;
      if (y >= slice.top && y < slice.bottom) return { page: pages[index] as PdfPage, index };
    }

    // Content can sit a rounded fraction below the final break; that belongs to
    // the last page rather than nowhere.
    if (lastContent !== undefined && y >= (slices[lastContent] as PageSlice).top) {
      return { page: pages[lastContent] as PdfPage, index: lastContent };
    }
    return undefined;
  };

  const wantsLinks = options.links !== false;
  const links = wantsLinks ? collectLinks(measured.root) : [];
  const destinations = new Map<string, PdfValue[]>();

  if (wantsLinks) {
    for (const anchor of collectAnchors(measured.root)) {
      const found = locate(anchor.rect.y);
      if (!found) continue;

      const transform = transformFor(found.index);
      destinations.set(
        anchor.id,
        destination(found.page, transform.x(anchor.rect.x), transform.y(anchor.rect.y)),
      );
    }
  }

  for (const [index, slice] of slices.entries()) {
    const page$ = contexts[index] as PageContext;
    const page = pages[index] as PdfPage;

    const pageHeight = ptToPx(page$.content.height);

    // A page beginning inside a table repeats that table's header at the top
    // and its footer at the foot. A blank page holds no rows, so it repeats
    // no table header either.
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

    if (wantsLinks && !slice.blank) {
      page.annotations.push(
        ...linkAnnotations(links, {
          transform: transformFor(index),
          band: { top: slice.top, bottom: slice.bottom },
          resolveFragment: (id) => destinations.get(id),
        }),
      );
    }

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

  return { slices, pages, destinations, locate, transformFor };
}
