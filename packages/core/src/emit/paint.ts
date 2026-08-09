/**
 * Painting boxes: backgrounds, borders, rounded corners.
 *
 * CSS box decoration is deceptively deep. This covers what a document actually
 * uses — solid fills, solid borders, uniform and non-uniform radii — and
 * degrades the rest predictably rather than pretending to support it.
 */

import type { ContentStream } from "../pdf/content.js";
import type { Rect as PageRect } from "../page/geometry.js";
import type { BorderSide, CapturedStyle, MeasuredColor } from "../measure/types.js";
import type { PageTransform } from "./transform.js";

/** Kappa: the circle-to-Bézier constant, for rounded corners. */
const KAPPA = 0.552_284_749_831;

export function isVisible(color: MeasuredColor): boolean {
  return color.a > 0;
}

/** Set the non-stroking colour from a measured colour. */
export function setFill(stream: ContentStream, color: MeasuredColor): void {
  stream.setFillRgb(color.r / 255, color.g / 255, color.b / 255);
}

/**
 * Append a rounded rectangle path.
 *
 * Radii are given clockwise from the top-left, matching CSS. They are scaled
 * down together when adjacent radii would overlap, which is what CSS itself
 * does rather than letting corners cross.
 */
export function roundedRectPath(
  stream: ContentStream,
  rect: PageRect,
  radii: readonly [number, number, number, number],
): void {
  const [rawTopLeft, rawTopRight, rawBottomRight, rawBottomLeft] = radii;

  // CSS shrinks all radii by a common factor when any edge is over-subscribed.
  const scale = Math.min(
    1,
    rect.width / Math.max(rawTopLeft + rawTopRight, 0.000_001),
    rect.width / Math.max(rawBottomLeft + rawBottomRight, 0.000_001),
    rect.height / Math.max(rawTopLeft + rawBottomLeft, 0.000_001),
    rect.height / Math.max(rawTopRight + rawBottomRight, 0.000_001),
  );

  const topLeft = rawTopLeft * scale;
  const topRight = rawTopRight * scale;
  const bottomRight = rawBottomRight * scale;
  const bottomLeft = rawBottomLeft * scale;

  const { x, y, width, height } = rect;
  const right = x + width;
  const top = y + height;

  // Drawn anticlockwise from the bottom-left, in PDF space where y is up.
  stream.moveTo(x + bottomLeft, y);
  stream.lineTo(right - bottomRight, y);
  if (bottomRight > 0) {
    stream.curveTo(
      right - bottomRight + bottomRight * KAPPA,
      y,
      right,
      y + bottomRight - bottomRight * KAPPA,
      right,
      y + bottomRight,
    );
  }

  stream.lineTo(right, top - topRight);
  if (topRight > 0) {
    stream.curveTo(
      right,
      top - topRight + topRight * KAPPA,
      right - topRight + topRight * KAPPA,
      top,
      right - topRight,
      top,
    );
  }

  stream.lineTo(x + topLeft, top);
  if (topLeft > 0) {
    stream.curveTo(
      x + topLeft - topLeft * KAPPA,
      top,
      x,
      top - topLeft + topLeft * KAPPA,
      x,
      top - topLeft,
    );
  }

  stream.lineTo(x, y + bottomLeft);
  if (bottomLeft > 0) {
    stream.curveTo(
      x,
      y + bottomLeft - bottomLeft * KAPPA,
      x + bottomLeft - bottomLeft * KAPPA,
      y,
      x + bottomLeft,
      y,
    );
  }

  stream.closePath();
}

export function hasRadius(radii: readonly [number, number, number, number]): boolean {
  return radii.some((radius) => radius > 0);
}

/** Append a rectangle path, rounded or not. */
export function boxPath(
  stream: ContentStream,
  rect: PageRect,
  radii: readonly [number, number, number, number],
): void {
  if (hasRadius(radii)) roundedRectPath(stream, rect, radii);
  else stream.rect(rect.x, rect.y, rect.width, rect.height);
}

/** Paint an element's background. */
export function paintBackground(
  stream: ContentStream,
  rect: PageRect,
  style: CapturedStyle,
  transform: PageTransform,
): void {
  if (!isVisible(style.backgroundColor)) return;
  if (rect.width <= 0 || rect.height <= 0) return;

  const radii = style.borderRadius.map((radius) => transform.length(radius)) as unknown as [
    number,
    number,
    number,
    number,
  ];

  stream.scoped((scoped) => {
    setFill(scoped, style.backgroundColor);
    boxPath(scoped, rect, radii);
    scoped.fill();
  });
}

/**
 * Paint borders.
 *
 * Each side is filled as its own trapezoid so that differing widths and colours
 * meet at a mitred corner, which is what a browser draws. A uniform border with
 * rounded corners is stroked instead, since mitring rounded corners by hand
 * gains nothing over the path the fill already describes.
 *
 * Dashed and dotted styles are painted solid: the geometry is right, the
 * texture is not. That is a visible-but-minor infidelity, and drawing it
 * properly needs a dash-pattern model this milestone does not have.
 */
export function paintBorders(
  stream: ContentStream,
  rect: PageRect,
  style: CapturedStyle,
  transform: PageTransform,
): void {
  const top = transform.length(style.borderTop.width);
  const right = transform.length(style.borderRight.width);
  const bottom = transform.length(style.borderBottom.width);
  const left = transform.length(style.borderLeft.width);

  if (top + right + bottom + left === 0) return;

  const sides: Array<[BorderSide, number]> = [
    [style.borderTop, top],
    [style.borderRight, right],
    [style.borderBottom, bottom],
    [style.borderLeft, left],
  ];
  if (!sides.some(([side, width]) => width > 0 && isVisible(side.color))) return;

  const radii = style.borderRadius.map((radius) => transform.length(radius)) as unknown as [
    number,
    number,
    number,
    number,
  ];

  const uniformWidth = top === right && right === bottom && bottom === left;
  const uniformColour = sides.every(([side]) => sameColor(side.color, style.borderTop.color));

  if (hasRadius(radii) && uniformWidth && uniformColour) {
    // Stroke runs centred on the path, so the path is inset by half the width
    // to land where CSS puts the border.
    const inset = top / 2;
    const strokeRect: PageRect = {
      x: rect.x + inset,
      y: rect.y + inset,
      width: Math.max(rect.width - top, 0),
      height: Math.max(rect.height - top, 0),
    };
    const strokeRadii = radii.map((radius) => Math.max(radius - inset, 0)) as unknown as [
      number,
      number,
      number,
      number,
    ];

    stream.scoped((scoped) => {
      const { color } = style.borderTop;
      scoped.setStrokeRgb(color.r / 255, color.g / 255, color.b / 255);
      scoped.setLineWidth(top);
      boxPath(scoped, strokeRect, strokeRadii);
      scoped.stroke();
    });
    return;
  }

  const outerRight = rect.x + rect.width;
  const outerTop = rect.y + rect.height;
  const innerLeft = rect.x + left;
  const innerRight = outerRight - right;
  const innerBottom = rect.y + bottom;
  const innerTop = outerTop - top;

  const fillQuad = (
    color: MeasuredColor,
    points: ReadonlyArray<readonly [number, number]>,
  ): void => {
    if (!isVisible(color)) return;
    stream.scoped((scoped) => {
      setFill(scoped, color);
      const [first, ...rest] = points;
      if (!first) return;
      scoped.moveTo(first[0], first[1]);
      for (const [x, y] of rest) scoped.lineTo(x, y);
      scoped.closePath().fill();
    });
  };

  if (top > 0) {
    fillQuad(style.borderTop.color, [
      [rect.x, outerTop],
      [outerRight, outerTop],
      [innerRight, innerTop],
      [innerLeft, innerTop],
    ]);
  }

  if (bottom > 0) {
    fillQuad(style.borderBottom.color, [
      [rect.x, rect.y],
      [innerLeft, innerBottom],
      [innerRight, innerBottom],
      [outerRight, rect.y],
    ]);
  }

  if (left > 0) {
    fillQuad(style.borderLeft.color, [
      [rect.x, rect.y],
      [innerLeft, innerBottom],
      [innerLeft, innerTop],
      [rect.x, outerTop],
    ]);
  }

  if (right > 0) {
    fillQuad(style.borderRight.color, [
      [outerRight, rect.y],
      [outerRight, outerTop],
      [innerRight, innerTop],
      [innerRight, innerBottom],
    ]);
  }
}

function sameColor(a: MeasuredColor, b: MeasuredColor): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
