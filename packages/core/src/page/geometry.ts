/**
 * Page geometry: sheet size, margins, and the content box the measurement
 * container is sized to.
 *
 * Coordinates here are PDF user space — origin bottom-left, y grows upward.
 * The DOM's origin is top-left with y growing downward; that flip happens once,
 * at extraction time, and never leaks into this module.
 */

import { toPt, type Length, type Pt } from "../units.js";

export interface PageSize {
  readonly width: Pt;
  readonly height: Pt;
}

export interface Margins {
  readonly top: Pt;
  readonly right: Pt;
  readonly bottom: Pt;
  readonly left: Pt;
}

export interface Rect {
  readonly x: Pt;
  readonly y: Pt;
  readonly width: Pt;
  readonly height: Pt;
}

export interface PageGeometry {
  readonly size: PageSize;
  readonly margins: Margins;
  /** The area content is laid out into, in PDF user space. */
  readonly content: Rect;
}

/** Sheet sizes in portrait orientation. */
const NAMED_SIZES = {
  a3: { width: "297mm", height: "420mm" },
  a4: { width: "210mm", height: "297mm" },
  a5: { width: "148mm", height: "210mm" },
  letter: { width: "8.5in", height: "11in" },
  legal: { width: "8.5in", height: "14in" },
  tabloid: { width: "11in", height: "17in" },
} as const;

export type NamedPageSize = "A3" | "A4" | "A5" | "Letter" | "Legal" | "Tabloid";

export type PageSizeInput =
  | NamedPageSize
  | (string & {})
  | { readonly width: Length; readonly height: Length };

export type Orientation = "portrait" | "landscape";

export type MarginsInput =
  | Length
  | {
      readonly top?: Length;
      readonly right?: Length;
      readonly bottom?: Length;
      readonly left?: Length;
    };

/** Default margin when the caller does not specify one. */
export const DEFAULT_MARGIN: Length = "0.5in";

export const DEFAULT_PAGE_SIZE: NamedPageSize = "A4";

export function isNamedPageSize(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(NAMED_SIZES, value.toLowerCase());
}

/** Resolve a page size to points, applying orientation. */
export function resolvePageSize(
  input: PageSizeInput = DEFAULT_PAGE_SIZE,
  orientation: Orientation = "portrait",
): PageSize {
  let width: Pt;
  let height: Pt;

  if (typeof input === "string") {
    const named = NAMED_SIZES[input.toLowerCase() as keyof typeof NAMED_SIZES];
    if (!named) {
      throw new RangeError(
        `Unknown page size ${JSON.stringify(input)}. Known sizes: ${Object.keys(NAMED_SIZES).join(", ")}.`,
      );
    }
    width = toPt(named.width);
    height = toPt(named.height);
  } else {
    width = toPt(input.width);
    height = toPt(input.height);
  }

  if (width <= 0 || height <= 0) {
    throw new RangeError(`Page size must be positive, received ${width}x${height}pt`);
  }

  // Orientation is applied to the resolved box rather than to named sizes only,
  // so a custom size honours it too.
  const landscape = orientation === "landscape";
  return landscape && height > width
    ? { width: height, height: width }
    : !landscape && width > height
      ? { width: height, height: width }
      : { width, height };
}

export function resolveMargins(input: MarginsInput = DEFAULT_MARGIN): Margins {
  if (typeof input === "number" || typeof input === "string") {
    const all = toPt(input);
    return { top: all, right: all, bottom: all, left: all };
  }

  const fallback = toPt(DEFAULT_MARGIN);
  const margins: Margins = {
    top: input.top === undefined ? fallback : toPt(input.top),
    right: input.right === undefined ? fallback : toPt(input.right),
    bottom: input.bottom === undefined ? fallback : toPt(input.bottom),
    left: input.left === undefined ? fallback : toPt(input.left),
  };

  for (const [side, value] of Object.entries(margins)) {
    if (value < 0) {
      throw new RangeError(`Margin ${side} must not be negative, received ${value}pt`);
    }
  }

  return margins;
}

/**
 * Compute the full geometry for a page.
 *
 * The content rect is what step 1 of the pipeline sizes the hidden measurement
 * container to, and what fragmentation treats as one page's worth of room.
 */
export function pageGeometry(
  sizeInput?: PageSizeInput,
  orientation: Orientation = "portrait",
  marginsInput?: MarginsInput,
): PageGeometry {
  const size = resolvePageSize(sizeInput, orientation);
  const margins = resolveMargins(marginsInput);

  const width = size.width - margins.left - margins.right;
  const height = size.height - margins.top - margins.bottom;

  if (width <= 0 || height <= 0) {
    throw new RangeError(
      `Margins leave no content area: ${width}x${height}pt on a ${size.width}x${size.height}pt page`,
    );
  }

  return {
    size,
    margins,
    content: { x: margins.left, y: margins.bottom, width, height },
  };
}
