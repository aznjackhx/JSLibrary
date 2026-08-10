/**
 * Painting captured SVG as PDF vector paths.
 *
 * Nothing here rasterizes. An SVG in the source becomes the same curves in the
 * output, so it stays sharp at any zoom and costs a few hundred bytes rather
 * than a few hundred kilobytes.
 *
 * The only real work is the coordinate flip. SVG's y grows downward and PDF's
 * grows upward, so a single `cm` maps the SVG's user space onto the element's
 * box on the page — after which every coordinate can be written out exactly as
 * it was authored.
 */

import type { CapturedPath, CapturedSvg } from "../measure/svg.js";
import { userSpaceTransform } from "../measure/svg.js";
import type { MeasuredColor, MeasuredRect } from "../measure/types.js";
import type { ContentStream } from "../pdf/content.js";
import { multiply, type Matrix } from "../svg/matrix.js";
import { pxToPt } from "../units.js";
import type { PageTransform } from "./transform.js";

const LINE_CAPS = { butt: 0, round: 1, square: 2 } as const;
const LINE_JOINS = { miter: 0, round: 1, bevel: 2 } as const;

/**
 * Map the SVG's user space onto its box on the page.
 *
 * Built as: apply the viewBox transform, flip y within the box, then move the
 * box to where the element sits in PDF user space. CSS pixels become points on
 * the way, since PDF measures in points.
 */
export function svgPlacement(svg: CapturedSvg, rect: MeasuredRect, page: PageTransform): Matrix {
  const scale = pxToPt(1);

  // Flip inside the box: an SVG y of 0 is the box's top edge, which is its
  // highest point in PDF space.
  const flip: Matrix = [scale, 0, 0, -scale, 0, pxToPt(svg.height)];

  // The box's lower-left corner on the page. `PageTransform.rect` reports
  // exactly that, which is the anchor a PDF rectangle uses.
  const placed = page.rect(rect);
  const move: Matrix = [1, 0, 0, 1, placed.x, placed.y];

  return multiply(multiply(userSpaceTransform(svg), flip), move);
}

/** Append one captured path's segments to the current path. */
function appendPath(stream: ContentStream, path: CapturedPath): void {
  for (const segment of path.segments) {
    switch (segment.kind) {
      case "move":
        stream.moveTo(segment.x, segment.y);
        break;
      case "line":
        stream.lineTo(segment.x, segment.y);
        break;
      case "cubic":
        stream.curveTo(segment.x1, segment.y1, segment.x2, segment.y2, segment.x, segment.y);
        break;
      case "close":
        stream.closePath();
        break;
    }
  }
}

export interface SvgPaintOptions {
  /** Applies a group opacity and returns the resource name to use. */
  readonly extGStateFor?: (opacity: number) => string;
}

function setFill(stream: ContentStream, colour: MeasuredColor): void {
  stream.setFillRgb(colour.r / 255, colour.g / 255, colour.b / 255);
}

function setStroke(stream: ContentStream, colour: MeasuredColor): void {
  stream.setStrokeRgb(colour.r / 255, colour.g / 255, colour.b / 255);
}

/**
 * Paint a captured SVG into a content stream.
 *
 * A path with neither fill nor stroke is skipped rather than emitted with no
 * painting operator, which would leave a dangling path in the stream.
 */
export function paintSvg(
  stream: ContentStream,
  svg: CapturedSvg,
  rect: MeasuredRect,
  page: PageTransform,
  options: SvgPaintOptions = {},
): number {
  const placement = svgPlacement(svg, rect, page);
  let painted = 0;

  stream.scoped((group) => {
    group.transform(...placement);

    for (const path of svg.paths) {
      if (!path.fill && !path.stroke) continue;
      if (path.opacity <= 0) continue;

      group.scoped((shape) => {
        if (path.opacity < 1 && options.extGStateFor) {
          shape.setExtGState(options.extGStateFor(path.opacity));
        }

        const [a, b, c, d, e, f] = path.transform;
        shape.transform(a, b, c, d, e, f);

        if (path.fill) setFill(shape, path.fill);

        if (path.stroke) {
          setStroke(shape, path.stroke);
          shape.setLineWidth(path.strokeWidth);
          shape.setLineCap(LINE_CAPS[path.lineCap]);
          shape.setLineJoin(LINE_JOINS[path.lineJoin]);
          if (path.dashArray.length > 0) shape.setDash(path.dashArray, path.dashOffset);
        }

        appendPath(shape, path);

        if (path.fill && path.stroke) shape.fillAndStroke(path.fillRule);
        else if (path.fill) shape.fill(path.fillRule);
        else shape.stroke();
      });

      painted += 1;
    }
  });

  return painted;
}
