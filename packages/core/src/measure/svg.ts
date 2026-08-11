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
  translation,
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

/** One colour stop of a gradient. */
export interface CapturedStop {
  /** Position along the gradient, 0 to 1. */
  readonly offset: number;
  readonly color: MeasuredColor;
}

/**
 * A gradient fill, as the geometry a PDF shading needs.
 *
 * Stop opacity is carried on the colour but cannot be honoured without a soft
 * mask, so a partly transparent stop paints at full strength. That is visible
 * and wrong in a way a reader can see, rather than silent, and it is far
 * better than the previous behaviour of painting nothing at all.
 */
export interface CapturedGradient {
  readonly kind: "linear" | "radial";
  /** Endpoints for a linear gradient, in the gradient's own coordinates. */
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Centre, focus and radius for a radial gradient. */
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fx: number;
  readonly fy: number;
  readonly stops: readonly CapturedStop[];
  /**
   * True when the coordinates above are fractions of the filled shape's
   * bounding box, which is SVG's default and is resolved at paint time
   * because only then is the box known.
   */
  readonly onBoundingBox: boolean;
  readonly transform: Matrix;
}

/** One drawable path, with the paint it carries. */
export interface CapturedPath {
  readonly segments: readonly PathSegment[];
  /** Transform from this path's coordinates to the SVG's own user space. */
  readonly transform: Matrix;
  readonly fill: MeasuredColor | undefined;
  /** Set when the fill is a gradient, in which case `fill` is undefined. */
  readonly fillGradient?: CapturedGradient | undefined;
  readonly stroke: MeasuredColor | undefined;
  readonly strokeWidth: number;
  readonly fillRule: "nonzero" | "evenodd";
  readonly lineCap: "butt" | "round" | "square";
  readonly lineJoin: "miter" | "round" | "bevel";
  readonly opacity: number;
  readonly dashArray: readonly number[];
  readonly dashOffset: number;
}

/** One character of SVG text, at the position the browser placed it. */
export interface CapturedSvgGlyph {
  readonly text: string;
  /** Baseline origin in the text element's user space. */
  readonly x: number;
  readonly y: number;
}

/**
 * A run of SVG text, as real text rather than outlines.
 *
 * Converting `<text>` to paths would be easier and is what most tools do. It
 * also makes the axis labels of every chart unselectable and unsearchable,
 * which is the exact failure this library exists to avoid, so the runs are
 * carried through to the emitter as text.
 */
export interface CapturedSvgText {
  /**
   * Per-character positions, read from the browser.
   *
   * Empty when the browser's character count disagreed with the run's own
   * text, in which case the run is placed whole at `x`/`y` instead. Positions
   * come from the layout engine, so `text-anchor`, `dx`/`dy`, `letter-spacing`
   * and `textLength` are all already accounted for — none of them is
   * reimplemented here.
   */
  readonly glyphs: readonly CapturedSvgGlyph[];
  readonly text: string;
  /** Where the run starts, used when per-character positions are unavailable. */
  readonly x: number;
  readonly y: number;
  /** Transform from the text element's coordinates to the SVG's user space. */
  readonly transform: Matrix;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly fontStyle: string;
  readonly fill: MeasuredColor | undefined;
  readonly opacity: number;
}

/** An inline SVG, flattened to paths and text runs. */
export interface CapturedSvg {
  /** Width and height of the rendered box, in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly viewBox: ViewBox | undefined;
  readonly preserveAspectRatio: string;
  readonly paths: readonly CapturedPath[];
  readonly texts: readonly CapturedSvgText[];
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

/** The fragment id of a `url(#id)` paint, if that is what this value is. */
function paintReference(value: string): string | undefined {
  const match = /^url\(\s*["\']?#([^"\')\s]+)["\']?\s*\)/.exec(value.trim());
  return match?.[1];
}

/**
 * Read a gradient element into the geometry a shading needs.
 *
 * Follows `href` to an inherited gradient, which is how a document defines one
 * gradient's stops and then varies only its coordinates — the common pattern
 * in chart libraries and icon sets.
 */
function gradientFrom(
  element: Element,
  view: Window & typeof globalThis,
  depth = 0,
): CapturedGradient | undefined {
  const tag = element.tagName.toLowerCase();
  if (tag !== "lineargradient" && tag !== "radialgradient") return undefined;

  // Attributes and stops can both come from a referenced gradient.
  const inheritedFrom =
    depth < 8
      ? (() => {
          const href =
            element.getAttribute("href") ??
            element.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
            "";
          if (!href.startsWith("#") || href.length < 2) return undefined;
          const target = element.ownerDocument.getElementById(href.slice(1));
          return target ? gradientFrom(target, view, depth + 1) : undefined;
        })()
      : undefined;

  const stops: CapturedStop[] = [];
  for (const stop of element.children) {
    if (stop.tagName.toLowerCase() !== "stop") continue;

    const computed = view.getComputedStyle(stop);
    const colour = parseColor(computed.stopColor || "rgb(0,0,0)");
    const stopOpacity = numberFrom(computed.stopOpacity, 1);

    const raw = stop.getAttribute("offset")?.trim() ?? "0";
    const offset = raw.endsWith("%")
      ? Number.parseFloat(raw) / 100
      : Number.parseFloat(raw);

    stops.push({
      offset: Math.max(0, Math.min(1, Number.isFinite(offset) ? offset : 0)),
      color: { ...colour, a: colour.a * stopOpacity },
    });
  }

  const own = element.getAttribute("gradientTransform");
  const has = (name: string): boolean => element.hasAttribute(name);
  const number_ = (name: string, fallback: number): number =>
    has(name) ? percentOrNumber(element.getAttribute(name) as string, fallback) : fallback;

  const resolved: CapturedGradient = {
    kind: tag === "radialgradient" ? "radial" : "linear",
    x1: number_("x1", inheritedFrom?.x1 ?? 0),
    y1: number_("y1", inheritedFrom?.y1 ?? 0),
    x2: number_("x2", inheritedFrom?.x2 ?? 1),
    y2: number_("y2", inheritedFrom?.y2 ?? 0),
    cx: number_("cx", inheritedFrom?.cx ?? 0.5),
    cy: number_("cy", inheritedFrom?.cy ?? 0.5),
    r: number_("r", inheritedFrom?.r ?? 0.5),
    fx: number_("fx", inheritedFrom?.fx ?? number_("cx", inheritedFrom?.cx ?? 0.5)),
    fy: number_("fy", inheritedFrom?.fy ?? number_("cy", inheritedFrom?.cy ?? 0.5)),
    stops: stops.length > 0 ? stops : (inheritedFrom?.stops ?? []),
    onBoundingBox: has("gradientUnits")
      ? element.getAttribute("gradientUnits") !== "userSpaceOnUse"
      : (inheritedFrom?.onBoundingBox ?? true),
    transform: own ? parseTransform(own) : (inheritedFrom?.transform ?? IDENTITY),
  };

  // A gradient with nothing to interpolate paints nothing; one stop is a flat
  // colour, which PDF needs at least two of to describe.
  if (resolved.stops.length === 0) return undefined;
  if (resolved.stops.length === 1) {
    const only = resolved.stops[0] as CapturedStop;
    return { ...resolved, stops: [{ ...only, offset: 0 }, { ...only, offset: 1 }] };
  }

  return resolved;
}

/** A gradient coordinate, which may be written as a percentage. */
function percentOrNumber(value: string, fallback: number): number {
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return fallback;
  return trimmed.endsWith("%") ? parsed / 100 : parsed;
}

/**
 * A paint value from computed style.
 *
 * `none` is distinct from transparent black: it means do not paint at all,
 * which is why this returns undefined rather than a zero-alpha colour. A
 * server paint — `url(#id)` — is resolved separately, since it produces a
 * shading rather than a colour.
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
 * SVG's own whitespace handling, for `xml:space="default"`.
 *
 * Newlines and tabs become spaces, runs collapse to one, and the ends of the
 * whole text element are trimmed. This has to match what the engine did,
 * because the character indices it answers questions about are indices into
 * the collapsed string, not into the source markup.
 */
function collapseSvgText(value: string): string {
  return value.replaceAll(/[\t\n\r]/g, " ").replaceAll(/ {2,}/g, " ");
}

/** The text-bearing elements inside a `<text>`, in document order. */
function textRuns(root: Element): { element: Element; text: string }[] {
  const runs: { element: Element; text: string }[] = [];

  const visit = (node: Element): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3 /* text */) {
        const data = (child as Text).data;
        if (data.length > 0) runs.push({ element: node, text: collapseSvgText(data) });
        continue;
      }
      if (child.nodeType === 1 /* element */) visit(child as Element);
    }
  };

  visit(root);
  return runs;
}

/**
 * Read one `<text>` element as positioned characters.
 *
 * The browser has already resolved anchoring, per-character offsets and any
 * `textLength` adjustment, and `getStartPositionOfChar` reports where each
 * character actually sits. Asking it beats reimplementing SVG text layout, for
 * the same reason the rest of the pipeline measures rather than lays out.
 */
function captureText(
  element: SVGTextElement,
  transform: Matrix,
  view: Window & typeof globalThis,
  into: CapturedSvgText[],
): void {
  const runs = textRuns(element);
  if (runs.length === 0) return;

  // Leading and trailing whitespace of the element as a whole is trimmed, not
  // of each run: a space between two `tspan`s survives, one before the first
  // does not.
  const first = runs[0] as { element: Element; text: string };
  first.text = first.text.replace(/^ /, "");
  const last = runs[runs.length - 1] as { element: Element; text: string };
  last.text = last.text.replace(/ $/, "");

  const total = runs.reduce((sum, run) => sum + run.text.length, 0);
  // When the engine counts characters differently from this, per-character
  // positions cannot be trusted to line up, so the run is placed whole.
  const positioned = total === element.getNumberOfChars();

  let index = 0;

  for (const run of runs) {
    const length = run.text.length;
    if (length === 0) continue;

    const start = index;
    index += length;
    if (run.text.trim() === "") continue;

    const computed = view.getComputedStyle(run.element);
    if (computed.display === "none" || computed.visibility === "hidden") continue;

    const glyphs: CapturedSvgGlyph[] = [];
    if (positioned) {
      for (let offset = 0; offset < length; offset += 1) {
        const point = element.getStartPositionOfChar(start + offset);
        glyphs.push({ text: run.text[offset] as string, x: point.x, y: point.y });
      }
    }

    const origin = positioned
      ? element.getStartPositionOfChar(start)
      : { x: attributeNumber(element, "x"), y: attributeNumber(element, "y") };

    into.push({
      glyphs,
      text: run.text,
      x: origin.x,
      y: origin.y,
      transform,
      fontFamily: computed.fontFamily,
      fontSize: Number.parseFloat(computed.fontSize) || 0,
      fontWeight: Number.parseInt(computed.fontWeight, 10) || 400,
      fontStyle: computed.fontStyle,
      // `fill` is the paint for text as it is for shapes; a text element with
      // `fill: none` is invisible and is not carried through.
      fill: paintOf(computed.fill),
      opacity: numberFrom(computed.opacity, 1),
    });
  }
}

/**
 * What a `use` points at, if it is a local reference this SVG contains.
 *
 * Only same-document fragments are followed. An external file would be a
 * network fetch, which this library never makes.
 */
function referencedElement(node: Element, root: SVGSVGElement): Element | undefined {
  const href =
    node.getAttribute("href") ??
    node.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
    "";

  if (!href.startsWith("#") || href.length < 2) return undefined;

  const id = href.slice(1);
  // Scoped to the SVG first so an id repeated elsewhere on the page cannot be
  // pulled in, then the document, since a `use` may legitimately point at
  // another SVG's defs.
  return (
    root.querySelector(`[id="${CSS.escape(id)}"]`) ??
    root.ownerDocument.getElementById(id) ??
    undefined
  );
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
  const texts: CapturedSvgText[] = [];

  /**
   * Elements currently being instanced through `use`, to stop a reference
   * cycle from recursing forever. SVG forbids one; a hand-written or
   * generated document can still contain one.
   */
  const instancing = new Set<Element>();

  const visit = (node: Element, inherited: Matrix): void => {
    const computed = view.getComputedStyle(node);
    if (computed.display === "none" || computed.visibility === "hidden") return;

    const own = node.getAttribute("transform");
    const transform = own ? multiply(parseTransform(own), inherited) : inherited;

    const tag = node.tagName.toLowerCase();

    // `defs`, `symbol`, `mask` and friends describe things to be referenced,
    // not things to draw. They are reached through the reference instead.
    if (tag === "defs" || tag === "symbol" || tag === "mask" || tag === "clippath") return;

    // `use` instances what it points at. This is how every icon sprite works,
    // so a document full of `use` used to come out blank.
    if (tag === "use") {
      const target = referencedElement(node, element);
      if (!target || instancing.has(target)) return;

      // The `x`/`y` are a translation inside the `use`'s own transform, not
      // outside it: a scaled `use` scales the offset too.
      const placed = multiply(
        translation(attributeNumber(node, "x"), attributeNumber(node, "y")),
        transform,
      );

      instancing.add(target);
      try {
        // A referenced `symbol` or `svg` is a container: its children draw,
        // it does not draw itself.
        const targetTag = target.tagName.toLowerCase();
        if (targetTag === "symbol" || targetTag === "svg") {
          for (const child of target.children) visit(child, placed);
        } else {
          visit(target, placed);
        }
      } finally {
        instancing.delete(target);
      }
      return;
    }

    // Text is read as text, and never descended into as though its `tspan`s
    // were shapes.
    if (tag === "text") {
      captureText(node as SVGTextElement, transform, view, texts);
      return;
    }

    if (SHAPE_TAGS.has(tag)) {
      const segments = segmentsFor(node);
      if (segments.length > 0) {
        const strokeWidth = numberFrom(computed.strokeWidth, 1);
        const stroke = paintOf(computed.stroke);

        // A `url(#id)` fill is a gradient or a pattern. Gradients become PDF
        // shadings; anything else still paints nothing, which is the honest
        // outcome for a paint server this cannot reproduce.
        const fillReference = paintReference(computed.fill);
        const referenced = fillReference
          ? element.ownerDocument.getElementById(fillReference)
          : undefined;
        const gradient = referenced ? gradientFrom(referenced, view) : undefined;

        paths.push({
          segments,
          transform,
          fill: paintOf(computed.fill),
          fillGradient: gradient,
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

  if (paths.length === 0 && texts.length === 0) return undefined;

  const viewBoxAttribute = element.getAttribute("viewBox");
  const viewBox = viewBoxAttribute ? parseViewBox(viewBoxAttribute) : undefined;

  return {
    width: box.width,
    height: box.height,
    viewBox,
    preserveAspectRatio: element.getAttribute("preserveAspectRatio") ?? "xMidYMid meet",
    paths,
    texts,
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
