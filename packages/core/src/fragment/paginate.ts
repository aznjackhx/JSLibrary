/**
 * Choosing where pages end.
 *
 * The rule is simple to state: fill each page with as much as fits without
 * dividing an atom, then start the next page at the first thing that did not
 * fit. Everything else — forced breaks, orphans, widows, repeated table
 * headers — is a constraint layered onto that loop rather than a different
 * algorithm.
 *
 * The one case with no good answer is an atom taller than the page. It cannot
 * fit anywhere, so it is placed and allowed to overflow rather than looping
 * forever looking for a break that does not exist.
 */

import type { BreakAtom, FragmentModel } from "./atoms.js";

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
}

export interface PaginateOptions {
  /** Usable height of one page's content box, in CSS pixels. */
  readonly pageHeight: number;
  /** Total height of the measured column, in CSS pixels. */
  readonly contentHeight: number;
}

/** Smallest advance that counts as progress, guarding against a stalled loop. */
const MIN_ADVANCE = 0.5;

export function paginate(model: FragmentModel, options: PaginateOptions): PageSlice[] {
  const { pageHeight, contentHeight } = options;

  if (!(pageHeight > 0)) {
    throw new RangeError(`Page content height must be positive, received ${pageHeight}`);
  }

  const atoms = model.atoms;
  const slices: PageSlice[] = [];

  let top = 0;
  let index = 0;
  // Atoms strictly above `top` are already placed; this marks where to resume.
  let cursor = 0;

  while (top < contentHeight || slices.length === 0) {
    const limit = top + pageHeight;

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
          // The very first atom on this page is taller than the page itself.
          // Nothing can be done but place it and move past it.
          const tall = atoms[scan] as BreakAtom;
          breakY = tall.bottom;
          overflowed = true;
        }
      } else {
        // Everything up to the limit fit. Prefer to end at the limit so that
        // whitespace below the last atom stays on this page rather than
        // pushing an empty band onto the next one.
        breakY = Math.max(limit, lastFittingBottom);
      }
    }

    if (breakY <= top + MIN_ADVANCE) breakY = top + pageHeight;

    const isLast = breakY >= contentHeight;
    slices.push({
      index,
      top,
      bottom: isLast ? Math.max(contentHeight, breakY) : breakY,
      overflowed,
    });

    if (isLast) break;

    top = breakY;
    index += 1;
  }

  return slices;
}
