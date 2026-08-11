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

import type { FontSubset } from "../fonts/font.js";
import type {
  CapturedPath,
  CapturedSvg,
  CapturedSvgGlyph,
  CapturedSvgText,
} from "../measure/svg.js";
import { userSpaceTransform } from "../measure/svg.js";
import type { MeasuredColor, MeasuredRect } from "../measure/types.js";
import type { ContentStream } from "../pdf/content.js";
import { multiply, type Matrix } from "../svg/matrix.js";
import { pxToPt } from "../units.js";
import { buildPositionedRun } from "./text.js";
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

/** A font, resolved and registered on the page, ready to show glyphs with. */
export interface SvgTextFont {
  readonly subset: FontSubset;
  readonly resourceName: string;
}

export interface SvgPaintOptions {
  /** Applies a group opacity and returns the resource name to use. */
  readonly extGStateFor?: (opacity: number) => string;
  /**
   * Resolves the font for a text run. Text is skipped when this is absent or
   * returns nothing — a chart with unlabelled axes beats a broken PDF.
   */
  readonly fontFor?: (run: CapturedSvgText) => SvgTextFont | undefined;
}

function setFill(stream: ContentStream, colour: MeasuredColor): void {
  stream.setFillRgb(colour.r / 255, colour.g / 255, colour.b / 255);
}

function setStroke(stream: ContentStream, colour: MeasuredColor): void {
  stream.setStrokeRgb(colour.r / 255, colour.g / 255, colour.b / 255);
}

/**
 * Paint one run of SVG text.
 *
 * Two coordinate details matter, and the second is easy to get subtly wrong.
 *
 * Every character is placed by its own matrix rather than advanced by the
 * font, because the positions came from the browser and already carry
 * anchoring, `dx`/`dy` and letter-spacing.
 *
 * And the group this sits inside has flipped y so SVG coordinates can be
 * written verbatim, which would draw text mirrored — so the text matrix flips
 * back. That counter-flip has to sit *inside* the element's own transform,
 * not outside it: a reflection either side of a rotation reverses the
 * rotation, and a label at `rotate(-90)` then reads top-to-bottom instead of
 * bottom-to-top. So the element transform is folded into the text matrix here
 * rather than emitted as a `cm` around it.
 */
function paintTextRun(
  stream: ContentStream,
  run: CapturedSvgText,
  font: SvgTextFont,
): boolean {
  // Characters sharing a baseline are one text object; a run that puts them on
  // different baselines — per-character `dy` — falls back to placing each on
  // its own, which is correct but extracts as separate fragments.
  const lines = baselines(run);

  let drew = false;

  stream.scoped((scoped) => {
    if (run.fill) setFill(scoped, run.fill);

    scoped.text((text) => {
      text.setFont(font.resourceName, run.fontSize);

      for (const line of lines) {
        const first = line[0];
        if (!first) continue;

        // The text matrix carries the baseline's origin, so the glyphs are
        // positioned relative to it and the run reads as one string.
        const items = buildPositionedRun(
          line.map((glyph) => ({ text: glyph.text, x: glyph.x - first.x })),
          0,
          run.fontSize,
          font.subset,
        );
        if (items.length === 0) continue;

        const [a, b, c, d, e, f] = multiply(
          [1, 0, 0, -1, first.x, first.y],
          run.transform,
        );

        text.setTextMatrix(a, b, c, d, e, f).showTextArray(items);
        drew = true;
      }
    });
  });

  return drew;
}

/** Group a run's characters into the baselines they sit on, in order. */
function baselines(run: CapturedSvgText): CapturedSvgGlyph[][] {
  if (run.glyphs.length === 0) {
    return [[{ text: run.text, x: run.x, y: run.y }]];
  }

  const groups: CapturedSvgGlyph[][] = [];
  let current: CapturedSvgGlyph[] = [];

  for (const glyph of run.glyphs) {
    const previous = current[current.length - 1];
    if (previous && previous.y !== glyph.y) {
      groups.push(current);
      current = [];
    }
    current.push(glyph);
  }

  if (current.length > 0) groups.push(current);
  return groups;
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

    for (const run of svg.texts) {
      if (!run.fill || run.opacity <= 0 || run.fontSize <= 0) continue;

      const font = options.fontFor?.(run);
      if (!font) continue;

      group.scoped((scoped) => {
        if (run.opacity < 1 && options.extGStateFor) {
          scoped.setExtGState(options.extGStateFor(run.opacity));
        }

        if (paintTextRun(scoped, run, font)) painted += 1;
      });
    }
  });

  return painted;
}
