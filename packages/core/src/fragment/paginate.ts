/**
 * Choosing where pages end.
 *
 * The rule is simple to state: fill each page with as much as fits without
 * dividing an atom, then start the next page at the first thing that did not
 * fit. Everything else — forced breaks, orphans, widows, repeated table
 * headers — is a constraint layered onto that loop rather than a different
 * algorithm.
 *
 * The one case with no good answer is an atom taller than the page. No break
 * inside it can be avoided, so it is divided at the page edge and continues
 * overleaf — reported through `overflowed`, because a box that asked not to be
 * broken was broken anyway.
 */

import type { BreakAtom, FragmentModel, PageParity } from "./atoms.js";
import { reservedHeightAt, type RepeatingTable } from "./tables.js";

/** One page's slice of the measured column. */
export interface PageSlice {
  readonly index: number;
  /** First y this page shows, in measured CSS pixels. */
  readonly top: number;
  /** First y the *next* page shows; the exclusive end of this one. */
  readonly bottom: number;
  /**
   * True when a single atom was taller than the page and had to overflow.
   * Surfaced rather than hidden: the output is wrong in a way the caller may
   * want to know about.
   */
  readonly overflowed: boolean;
  /**
   * Height given up at the top of this page to repeated table headers, in CSS
   * pixels. Content is painted below it.
   */
  readonly reservedTop: number;
  /** Height given up at the foot of the page to repeated table footers. */
  readonly reservedBottom: number;
  /**
   * True for a page generated to satisfy a side-specific break rather than to
   * hold content. It shows nothing from the measured column, but it is a real
   * page: it is counted, it is numbered, and `@page :blank` styles it.
   */
  readonly blank: boolean;
}

export interface PaginateOptions {
  /**
   * Usable height of a page's content box, in CSS pixels.
   *
   * A function rather than a number, because `@page :first` may set different
   * margins from the rest of the document, which changes how much each page
   * can hold.
   */
  readonly pageHeight: number | ((pageIndex: number) => number);
  /** Total height of the measured column, in CSS pixels. */
  readonly contentHeight: number;
  /**
   * Tables whose header and footer repeat. A page beginning inside one has
   * less room for content, which changes where the page can end.
   */
  readonly tables?: readonly RepeatingTable[];
}

/** Smallest advance that counts as progress, guarding against a stalled loop. */
const MIN_ADVANCE = 0.5;

/**
 * Does a page at this index fall on the side a break demanded?
 *
 * Page one is a right-hand page in a left-to-right document, so even indices
 * are right and odd indices are left — the same convention `@page :left` and
 * `@page :right` use, and they have to agree or a chapter forced onto a
 * right-hand page would be styled as a left one.
 */
function satisfiesParity(parity: PageParity, pageIndex: number): boolean {
  if (parity === "any") return true;
  return parity === "right" ? pageIndex % 2 === 0 : pageIndex % 2 === 1;
}

export function paginate(model: FragmentModel, options: PaginateOptions): PageSlice[] {
  const { contentHeight } = options;
  const heightOf =
    typeof options.pageHeight === "function"
      ? options.pageHeight
      : (): number => options.pageHeight as number;

  const atoms = model.atoms;
  const slices: PageSlice[] = [];

  let top = 0;
  let index = 0;
  // Atoms strictly above `top` are already placed; this marks where to resume.
  let cursor = 0;

  const tables = options.tables ?? [];

  while (top < contentHeight || slices.length === 0) {
    const pageHeight = heightOf(index);
    if (!(pageHeight > 0)) {
      throw new RangeError(`Page content height must be positive, received ${pageHeight}`);
    }

    // A page that begins inside a table repeats its header, and that header
    // occupies room this page cannot give to rows.
    const reserved = reservedHeightAt(tables, top, pageHeight);
    const reservedTop = reserved.top;
    const reservedBottom = reserved.bottom;
    const usable = Math.max(pageHeight - reservedTop - reservedBottom, MIN_ADVANCE);
    const limit = top + usable;

    // The earliest demanded break below this page's start wins outright.
    const forced = model.forced.find((candidate) => candidate.y > top + MIN_ADVANCE);
    const forcedY = forced && forced.y <= limit ? forced.y : undefined;

    while (cursor < atoms.length && (atoms[cursor] as BreakAtom).bottom <= top) cursor += 1;

    let breakY = forcedY ?? limit;
    let overflowed = false;

    if (forcedY === undefined) {
      // Walk the atoms this page could hold; stop at the first that would not
      // fit, and end the page at its top.
      let scan = cursor;
      let lastFittingBottom = top;
      let firstOverflowingTop: number | undefined;

      while (scan < atoms.length) {
        const atom = atoms[scan] as BreakAtom;
        if (atom.top >= limit) break;

        if (atom.bottom <= limit) {
          lastFittingBottom = Math.max(lastFittingBottom, atom.bottom);
          scan += 1;
          continue;
        }

        firstOverflowingTop = atom.top;
        break;
      }

      if (firstOverflowingTop !== undefined) {
        if (firstOverflowingTop > top + MIN_ADVANCE) {
          // End the page above the atom that did not fit.
          breakY = firstOverflowingTop;
        } else {
          // The first atom on this page is taller than the page itself, so no
          // break inside it can be avoided — the only question is where.
          //
          // Ending the page below it, which is what this did, runs it past the
          // bottom of the page where it is clipped and simply lost: a table row
          // with a long note in a cell showed its first page and nothing after.
          // Cutting at the page limit instead divides the atom and lets the
          // rest continue overleaf, which is what a browser does and what a
          // reader needs. The overflow is still reported, because breaking
          // inside a box that asked not to be broken is worth knowing about.
          breakY = limit;
          overflowed = true;
        }
      } else {
        // Everything up to the limit fit. Prefer to end at the limit so that
        // whitespace below the last atom stays on this page rather than
        // pushing an empty band onto the next one.
        breakY = Math.max(limit, lastFittingBottom);
      }
    }

    if (breakY <= top + MIN_ADVANCE) breakY = top + usable;

    const isLast = breakY >= contentHeight;
    slices.push({
      index,
      top,
      bottom: isLast ? Math.max(contentHeight, breakY) : breakY,
      overflowed,
      reservedTop,
      reservedBottom,
      blank: false,
    });

    if (isLast) break;

    top = breakY;
    index += 1;

    // The page now beginning holds the content the forced break pushed down.
    // If that break demanded a side, and this page is on the wrong one, a
    // blank page goes in between. Parity alternates, so this inserts at most
    // one page and cannot loop.
    while (forced && forcedY !== undefined && !satisfiesParity(forced.parity, index)) {
      slices.push({
        index,
        top,
        bottom: top,
        overflowed: false,
        reservedTop: 0,
        reservedBottom: 0,
        blank: true,
      });
      index += 1;
    }
  }

  return slices;
}
