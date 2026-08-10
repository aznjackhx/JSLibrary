/**
 * Computed style capture.
 *
 * `getComputedStyle` returns strings; everything downstream wants numbers and
 * colours. Parsing happens once, here, so no other module has to know that CSS
 * reports lengths as `"12px"` and colours as `"rgba(1, 2, 3, 0.5)"`.
 */

import type { BorderSide, CapturedStyle, MeasuredColor } from "./types.js";

/**
 * Rounding applied to every captured length.
 *
 * Sub-thousandth differences are below any visible threshold but are enough to
 * make two runs disagree byte for byte, which would break golden comparison.
 */
const DECIMALS = 3;

/** Used for `line-height: normal`, which computes to a string, not a length. */
const NORMAL_LINE_HEIGHT_RATIO = 1.2;

export const TRANSPARENT: MeasuredColor = { r: 0, g: 0, b: 0, a: 0 };

export function round(value: number, decimals = DECIMALS): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor + 0;
}

/** Parse a CSS length that has already been computed to pixels. */
export function parsePx(value: string, fallback = 0): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? round(parsed) : fallback;
}

/**
 * Parse a computed colour.
 *
 * Computed values are always `rgb()` or `rgba()` — keywords and hex are
 * resolved by the time they reach us — but `color()` and friends can appear in
 * newer engines, so anything unrecognised degrades to transparent rather than
 * throwing mid-measurement.
 */
export function parseColor(value: string): MeasuredColor {
  if (!value || value === "transparent" || value === "none") return TRANSPARENT;

  const match = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!match) return TRANSPARENT;

  // Both comma and space separated forms occur, and alpha may follow a slash.
  const parts = (match[1] as string)
    .replaceAll("/", " ")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number.parseFloat);

  const [r = 0, g = 0, b = 0, a = 1] = parts;
  if (![r, g, b].every(Number.isFinite)) return TRANSPARENT;

  return {
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
    a: Number.isFinite(a) ? round(a) : 1,
  };
}

function borderSide(style: CSSStyleDeclaration, side: string): BorderSide {
  const width = parsePx(style.getPropertyValue(`border-${side}-width`));
  const lineStyle = style.getPropertyValue(`border-${side}-style`) || "none";

  return {
    // A border with style `none` has no width regardless of what is declared.
    width: lineStyle === "none" || lineStyle === "hidden" ? 0 : width,
    style: lineStyle,
    color: parseColor(style.getPropertyValue(`border-${side}-color`)),
  };
}

/** `font-weight` computes to a number, but older engines can still say `normal`. */
function parseWeight(value: string): number {
  switch (value) {
    case "normal":
      return 400;
    case "bold":
      return 700;
    default: {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 400;
    }
  }
}

/** `orphans` and `widows` default to 2 per the CSS fragmentation spec. */
function parseCount(value: string, fallback = 2): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read the properties the pipeline needs.
 *
 * Deliberately a fixed list rather than everything: a full computed style is
 * roughly 340 properties per element, which would dominate both measurement
 * time and the size of any geometry dump.
 */
export function captureStyle(computed: CSSStyleDeclaration): CapturedStyle {
  const fontSize = parsePx(computed.fontSize, 16);
  const lineHeightRaw = computed.lineHeight;

  return {
    display: computed.display,
    position: computed.position,
    fontFamily: computed.fontFamily,
    fontSize,
    fontWeight: parseWeight(computed.fontWeight),
    fontStyle: computed.fontStyle,
    // `normal` is a used value the engine computes per font; this approximation
    // is a hint only. Real line geometry comes from measured line rects.
    lineHeight:
      lineHeightRaw === "normal"
        ? round(fontSize * NORMAL_LINE_HEIGHT_RATIO)
        : parsePx(lineHeightRaw, round(fontSize * NORMAL_LINE_HEIGHT_RATIO)),
    letterSpacing: computed.letterSpacing === "normal" ? 0 : parsePx(computed.letterSpacing),
    wordSpacing: computed.wordSpacing === "normal" ? 0 : parsePx(computed.wordSpacing),
    textAlign: computed.textAlign,
    textDecorationLine: computed.getPropertyValue("text-decoration-line") || "none",
    whiteSpace: computed.whiteSpace,
    color: parseColor(computed.color),
    backgroundColor: parseColor(computed.backgroundColor),
    opacity: Number.parseFloat(computed.opacity) || (computed.opacity === "0" ? 0 : 1),
    borderTop: borderSide(computed, "top"),
    borderRight: borderSide(computed, "right"),
    borderBottom: borderSide(computed, "bottom"),
    borderLeft: borderSide(computed, "left"),
    borderRadius: [
      parsePx(computed.borderTopLeftRadius),
      parsePx(computed.borderTopRightRadius),
      parsePx(computed.borderBottomRightRadius),
      parsePx(computed.borderBottomLeftRadius),
    ],
    padding: [
      parsePx(computed.paddingTop),
      parsePx(computed.paddingRight),
      parsePx(computed.paddingBottom),
      parsePx(computed.paddingLeft),
    ],
    margin: [
      parsePx(computed.marginTop),
      parsePx(computed.marginRight),
      parsePx(computed.marginBottom),
      parsePx(computed.marginLeft),
    ],
    overflow: computed.overflow,
    boxDecorationBreak:
      computed.getPropertyValue("box-decoration-break") ||
      computed.getPropertyValue("-webkit-box-decoration-break") ||
      "slice",
    visibility: computed.visibility,
    transform: computed.transform,
    zIndex: computed.zIndex,
    breakBefore: computed.getPropertyValue("break-before") || "auto",
    breakAfter: computed.getPropertyValue("break-after") || "auto",
    breakInside: computed.getPropertyValue("break-inside") || "auto",
    orphans: parseCount(computed.getPropertyValue("orphans")),
    widows: parseCount(computed.getPropertyValue("widows")),
  };
}

/** True when the element paints nothing itself — no background, no border. */
export function isVisuallyEmpty(style: CapturedStyle): boolean {
  if (style.backgroundColor.a > 0) return false;
  for (const side of [style.borderTop, style.borderRight, style.borderBottom, style.borderLeft]) {
    if (side.width > 0 && side.color.a > 0) return false;
  }
  return true;
}
