/**
 * Length handling.
 *
 * PDF user space is 1/72 inch ("points"). CSS pixels are 1/96 inch. Every
 * geometry value in this library is normalised to points at the boundary, so
 * nothing downstream has to remember which unit it is holding.
 */

/** A length expressed in PDF points (1/72 inch). */
export type Pt = number;

/** A length accepted from user input: a number of CSS pixels, or a CSS length string. */
export type Length = number | string;

const PT_PER_INCH = 72;
const CSS_PX_PER_INCH = 96;

/** Multipliers from one unit of `key` to points. */
const UNIT_TO_PT = {
  pt: 1,
  px: PT_PER_INCH / CSS_PX_PER_INCH,
  in: PT_PER_INCH,
  pc: 12,
  mm: PT_PER_INCH / 25.4,
  cm: PT_PER_INCH / 2.54,
  q: PT_PER_INCH / 25.4 / 4,
} as const;

export type Unit = keyof typeof UNIT_TO_PT;

const LENGTH_PATTERN = /^([+-]?(?:\d+\.?\d*|\.\d+))(pt|px|in|pc|mm|cm|q)?$/i;

/** CSS pixels to points. */
export function pxToPt(px: number): Pt {
  return px * UNIT_TO_PT.px;
}

/** Points to CSS pixels. */
export function ptToPx(pt: Pt): number {
  return pt / UNIT_TO_PT.px;
}

/**
 * Parse a length into points.
 *
 * A bare number is interpreted as CSS pixels, matching the rest of the DOM
 * APIs we read geometry from. Strings carry their own unit; a unitless string
 * is also treated as pixels.
 */
export function toPt(value: Length): Pt {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Length must be finite, received ${value}`);
    }
    return pxToPt(value);
  }

  const match = LENGTH_PATTERN.exec(value.trim());
  if (!match) {
    throw new RangeError(`Cannot parse length ${JSON.stringify(value)}`);
  }

  // Group 1 is non-optional in the pattern, so it is always present on a match.
  const magnitude = Number.parseFloat(match[1] as string);
  const unit = (match[2]?.toLowerCase() ?? "px") as Unit;
  return magnitude * UNIT_TO_PT[unit];
}

/**
 * Round to a fixed number of decimals.
 *
 * Emission uses this so that identical input produces byte-identical output:
 * the PDF content stream must not inherit float noise from layout maths.
 */
export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  // `+ 0` normalises -0 to 0 so it never serialises as "-0".
  return Math.round(value * factor) / factor + 0;
}
