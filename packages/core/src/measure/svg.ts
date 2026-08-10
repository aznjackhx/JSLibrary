/**
 * Reading an inline `<svg>` out of the DOM as vector geometry.
 *
 * The rest of this pipeline asks the browser where things ended up. SVG is the
 * exception: its geometry *is* the markup, so it is read directly rather than
 * measured. What the browser is still asked for is style — `getComputedStyle`
 * resolves presentation attributes, CSS rules and inheritance into one answer,
 * so `fill="red"`, `fill: red` and an inherited fill all arrive the same way.
 *
 * Raster output is never involved. That is the whole point: an icon in the PDF
 * is the same paths the browser drew, and stays sharp at any zoom.
 */

import {
  IDENTITY,
  multiply,
  parseTransform,
  parseViewBox,
  viewBoxTransform,
  type Matrix,
  type ViewBox,
} from "../svg/matrix.js";
import { parsePathData, type PathSegment } from "../svg/path.js";
import {
  ellipseSegments,
  lineSegments,
  parsePoints,
  polySegments,
  rectSegments,
} from "../svg/shapes.js";
import { parseColor } from "./styles.js";
import type { MeasuredColor } from "./types.js";

/** One drawable path, with the paint it carries. */
export interface CapturedPath {
  readonly segments: readonly PathSegment[];
  /** Transform from this path's coordinates to the SVG's own user space. */
  readonly transform: Matrix;
  readonly fill: MeasuredColor | undefined;
  readonly stroke: MeasuredColor | undefined;
  readonly strokeWidth: number;
  readonly fillRule: "nonzero" | "evenodd";
  readonly lineCap: "butt" | "round" | "square";
  readonly lineJoin: "miter" | "round" | "bevel";
  readonly opacity: number;
  readonly dashArray: readonly number[];
  readonly dashOffset: number;
}

/** An inline SVG, flattened to paths. */
export interface CapturedSvg {
  /** Width and height of the rendered box, in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly viewBox: ViewBox | undefined;
  readonly preserveAspectRatio: string;
  readonly paths: readonly CapturedPath[];
}

/** Elements that contribute geometry. */
const SHAPE_TAGS = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);

/** A number attribute, defaulting when absent or unparseable. */
function attributeNumber(element: Element, attribute: string, fallback = 0): number {
  const raw = element.getAttribute(attribute);
  if (raw === null) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A length that may be absent, which some attributes distinguish from zero. */
function optionalNumber(element: Element, attribute: string): number | undefined {
  const raw = element.getAttribute(attribute);
  if (raw === null || raw.trim() === "" || raw.trim() === "auto") return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A paint value from computed style.
 *
 * `none` is distinct from transparent black: it means do not paint at all,
 * which is why this returns undefined rather than a zero-alpha colour. Server
 * paints — gradients and patterns, written `url(#id)` — are not supported and
 * are treated the same way, so a gradient-filled shape is left unpainted
 * rather than filled with a wrong flat colour.
 */
function paintOf(value: string): MeasuredColor | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "none") return undefined;
  if (trimmed.startsWith("url(")) return undefined;

  const colour = parseColor(trimmed);
  return colour.a === 0 ? undefined : colour;
}

function numberFrom(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Segments for one shape element, in its own coordinates. */
function segmentsFor(element: Element): PathSegment[] {
  switch (element.tagName.toLowerCase()) {
    case "path":
      return parsePathData(element.getAttribute("d") ?? "");
    case "rect": {
      const rx = optionalNumber(element, "rx");
      const ry = optionalNumber(element, "ry");
      return rectSegments({
        x: attributeNumber(element, "x"),
        y: attributeNumber(element, "y"),
        width: attributeNumber(element, "width"),
        height: attributeNumber(element, "height"),
        ...(rx === undefined ? {} : { rx }),
        ...(ry === undefined ? {} : { ry }),
      });
    }
    case "circle": {
      const r = attributeNumber(element, "r");
      return ellipseSegments(
        attributeNumber(element, "cx"),
        attributeNumber(element, "cy"),
        r,
        r,
      );
    }
    case "ellipse":
      return ellipseSegments(
        attributeNumber(element, "cx"),
        attributeNumber(element, "cy"),
        attributeNumber(element, "rx"),
        attributeNumber(element, "ry"),
      );
    case "line":
      return lineSegments(
        attributeNumber(element, "x1"),
        attributeNumber(element, "y1"),
        attributeNumber(element, "x2"),
        attributeNumber(element, "y2"),
      );
    case "polyline":
      return polySegments(parsePoints(element.getAttribute("points") ?? ""), false);
    case "polygon":
      return polySegments(parsePoints(element.getAttribute("points") ?? ""), true);
    default:
      return [];
  }
}

/** Parse a `stroke-dasharray`, discarding the forms that disable dashing. */
function parseDashArray(value: string): number[] {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "none") return [];

  const numbers = trimmed
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part) && part >= 0);

  // An all-zero array means a solid line, and a zero-length dash would make a
  // PDF viewer refuse the whole content stream.
  return numbers.some((number) => number > 0) ? numbers : [];
}

/**
 * Flatten an inline SVG into paths.
 *
 * Returns undefined when there is nothing to draw, so a caller can fall back
 * rather than emit an empty group.
 */
export function captureSvg(element: SVGSVGElement): CapturedSvg | undefined {
  const view = element.ownerDocument.defaultView;
  if (!view) return undefined;

  const box = element.getBoundingClientRect();
  const paths: CapturedPath[] = [];

  const visit = (node: Element, inherited: Matrix): void => {
    const computed = view.getComputedStyle(node);
    if (computed.display === "none" || computed.visibility === "hidden") return;

    const own = node.getAttribute("transform");
    const transform = own ? multiply(parseTransform(own), inherited) : inherited;

    const tag = node.tagName.toLowerCase();

    // `defs`, `symbol`, `mask` and friends describe things to be referenced,
    // not things to draw. `use` would need reference resolution and cloned
    // subtrees, which this does not do; a `use` therefore draws nothing rather
    // than drawing the wrong thing.
    if (tag === "defs" || tag === "symbol" || tag === "mask" || tag === "clippath") return;

    if (SHAPE_TAGS.has(tag)) {
      const segments = segmentsFor(node);
      if (segments.length > 0) {
        const strokeWidth = numberFrom(computed.strokeWidth, 1);
        const stroke = paintOf(computed.stroke);

        paths.push({
          segments,
          transform,
          fill: paintOf(computed.fill),
          // A zero-width stroke paints nothing, so it is dropped here rather
          // than emitting an operator that draws a hairline.
          stroke: strokeWidth > 0 ? stroke : undefined,
          strokeWidth,
          fillRule: computed.fillRule === "evenodd" ? "evenodd" : "nonzero",
          lineCap: lineCapOf(computed.strokeLinecap),
          lineJoin: lineJoinOf(computed.strokeLinejoin),
          opacity: numberFrom(computed.opacity, 1),
          dashArray: parseDashArray(computed.strokeDasharray),
          dashOffset: numberFrom(computed.strokeDashoffset, 0),
        });
      }
      return;
    }

    for (const child of node.children) visit(child, transform);
  };

  for (const child of element.children) visit(child, IDENTITY);

  if (paths.length === 0) return undefined;

  const viewBoxAttribute = element.getAttribute("viewBox");
  const viewBox = viewBoxAttribute ? parseViewBox(viewBoxAttribute) : undefined;

  return {
    width: box.width,
    height: box.height,
    viewBox,
    preserveAspectRatio: element.getAttribute("preserveAspectRatio") ?? "xMidYMid meet",
    paths,
  };
}

function lineCapOf(value: string): "butt" | "round" | "square" {
  return value === "round" || value === "square" ? value : "butt";
}

function lineJoinOf(value: string): "miter" | "round" | "bevel" {
  return value === "round" || value === "bevel" ? value : "miter";
}

/**
 * The transform from the SVG's user space to its rendered box.
 *
 * Without a `viewBox` the two are the same, so user units are CSS pixels.
 */
export function userSpaceTransform(svg: CapturedSvg): Matrix {
  if (!svg.viewBox) return IDENTITY;
  return viewBoxTransform(svg.viewBox, svg.width, svg.height, svg.preserveAspectRatio);
}
