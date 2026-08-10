/**
 * The measurement data model.
 *
 * Geometry here is in **CSS pixels relative to the measurement container's
 * content origin**, with y growing downward — exactly what the DOM reported.
 * The flip into PDF user space happens once, at emission, so that measurement
 * stays a faithful record of what the browser did and only one module has to
 * know about the coordinate flip.
 */

/** A rectangle in container-relative CSS pixels, y downward. */
export interface MeasuredRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An RGBA colour with components 0–255 and alpha 0–1. */
export interface MeasuredColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface BorderSide {
  readonly width: number;
  readonly style: string;
  readonly color: MeasuredColor;
}

export interface CapturedStyle {
  readonly display: string;
  readonly position: string;
  /** `left`, `right`, or `none`. Floats leave the normal flow horizontally. */
  readonly float: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly fontStyle: string;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly wordSpacing: number;
  readonly textAlign: string;
  readonly textDecorationLine: string;
  readonly whiteSpace: string;
  readonly color: MeasuredColor;
  readonly backgroundColor: MeasuredColor;
  readonly opacity: number;
  readonly borderTop: BorderSide;
  readonly borderRight: BorderSide;
  readonly borderBottom: BorderSide;
  readonly borderLeft: BorderSide;
  readonly borderRadius: readonly [number, number, number, number];
  readonly padding: readonly [number, number, number, number];
  readonly margin: readonly [number, number, number, number];
  readonly overflow: string;
  /**
   * `slice` (the CSS default) draws the box as though it were continuous and
   * then cut, so no border appears at the fragment seam. `clone` closes the box
   * on each fragment, repeating the border and padding.
   */
  readonly boxDecorationBreak: string;
  readonly visibility: string;
  readonly transform: string;
  readonly zIndex: string;
  /** Fragmentation hints, read here so the engine never re-queries the DOM. */
  readonly breakBefore: string;
  readonly breakAfter: string;
  readonly breakInside: string;
  readonly orphans: number;
  readonly widows: number;
}

/** One glyph cluster's horizontal position, for the precise text path. */
export interface MeasuredCluster {
  /** The grapheme this cluster renders. */
  readonly text: string;
  /** Left edge, container-relative. */
  readonly x: number;
  readonly width: number;
}

/** A single laid-out line of text. */
export interface MeasuredLine {
  readonly text: string;
  /** The inline box the browser reported for this line. */
  readonly rect: MeasuredRect;
  /**
   * Baseline y, container-relative.
   *
   * Measured from the browser rather than derived from font metrics — see
   * `baseline.ts` for why that distinction matters.
   */
  readonly baseline: number;
  /** Per-cluster positions. Present only when precise text positioning is on. */
  readonly clusters?: readonly MeasuredCluster[];
}

export interface MeasuredText {
  readonly kind: "text";
  readonly text: string;
  readonly lines: readonly MeasuredLine[];
}

export interface MeasuredElement {
  readonly kind: "element";
  readonly tag: string;
  readonly id: string | undefined;
  readonly classes: readonly string[];
  /** Border box, container-relative. */
  readonly rect: MeasuredRect;
  /** Content box, container-relative. */
  readonly contentRect: MeasuredRect;
  readonly style: CapturedStyle;
  /** Present for images and other replaced content. */
  readonly src: string | undefined;
  /**
   * Key into the captured image map, when pixels were successfully read.
   *
   * Pixels live outside the tree so that a geometry dump stays comparable —
   * embedding megabytes of image data in it would make golden diffs useless.
   */
  readonly imageRef: string | undefined;
  /** Vector geometry, for an inline `<svg>`. */
  readonly svg: import("./svg.js").CapturedSvg | undefined;
  /** The `href` attribute exactly as authored; `#section` stays a fragment. */
  readonly href: string | undefined;
  /** The same href resolved against the document's base URL. */
  readonly hrefResolved: string | undefined;
  readonly children: readonly MeasuredNode[];
}

export type MeasuredNode = MeasuredElement | MeasuredText;

export interface MeasuredDocument {
  /** The width the content was laid out into, in CSS pixels. */
  readonly contentWidth: number;
  /** Total laid-out height, in CSS pixels. */
  readonly contentHeight: number;
  readonly root: MeasuredElement;
}

/**
 * Everything a measurement pass produced.
 *
 * Geometry and pixel payloads are kept apart: the tree is small and comparable,
 * the images are neither.
 */
export interface MeasureResult {
  readonly document: MeasuredDocument;
  /** Captured pixels, keyed by `MeasuredElement.imageRef`. */
  readonly images: ReadonlyMap<string, import("./images.js").CapturedImage>;
  /** Named-string assignments, in document order. */
  readonly strings: readonly import("../page/string-set.js").StringAssignment[];
}
