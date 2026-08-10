/**
 * The sixteen `@page` margin boxes.
 *
 * These are the only text this library draws that the browser never laid out:
 * a running header exists nowhere in the document, so its position has to be
 * computed from font metrics rather than read back from a Range. That is why
 * margin-box text always takes the fast path — there are no measured cluster
 * positions to be faithful to, only the font's own advances.
 */

import type { Font } from "../fonts/font.js";
import type { FontSubset } from "../fonts/font.js";
import { encodeCids } from "../fonts/embed.js";
import type { ContentFacts } from "../page/content-value.js";
import { evaluateContent } from "../page/content-value.js";
import { MARGIN_BOX_NAMES, type MarginBoxName } from "../page/atrules.js";
import type { PageContext } from "../page/context.js";
import type { ContentStream } from "../pdf/content.js";
import { parseColor } from "../measure/styles.js";
import type { MeasuredColor } from "../measure/types.js";
import { toPt, type Pt } from "../units.js";
import { setFill } from "./paint.js";

/** A margin box's rectangle in PDF user space. */
export interface MarginBoxRect {
  readonly x: Pt;
  readonly y: Pt;
  readonly width: Pt;
  readonly height: Pt;
}

/** Default horizontal alignment implied by a box's name. */
function defaultAlign(name: MarginBoxName): "left" | "center" | "right" {
  if (name.endsWith("-left") || name.endsWith("left-corner")) return "left";
  if (name.endsWith("-right") || name.endsWith("right-corner")) return "right";
  if (name.startsWith("left-")) return "left";
  if (name.startsWith("right-")) return "right";
  return "center";
}

/**
 * Geometry of every margin box for a page.
 *
 * The corners take the margins they sit in. Each edge is divided into three
 * equal parts, which is not the specification's content-based sizing but is
 * predictable and cannot overlap — two headers that each claim the full edge
 * would print on top of each other.
 */
export function marginBoxRects(page: PageContext): Map<MarginBoxName, MarginBoxRect> {
  const { size, margins } = page;
  const rects = new Map<MarginBoxName, MarginBoxRect>();

  const innerWidth = size.width - margins.left - margins.right;
  const innerHeight = size.height - margins.top - margins.bottom;
  const third = innerWidth / 3;
  const verticalThird = innerHeight / 3;

  const topY = size.height - margins.top;
  const bottomY = 0;

  // Corners.
  rects.set("top-left-corner", { x: 0, y: topY, width: margins.left, height: margins.top });
  rects.set("top-right-corner", {
    x: size.width - margins.right,
    y: topY,
    width: margins.right,
    height: margins.top,
  });
  rects.set("bottom-left-corner", {
    x: 0,
    y: bottomY,
    width: margins.left,
    height: margins.bottom,
  });
  rects.set("bottom-right-corner", {
    x: size.width - margins.right,
    y: bottomY,
    width: margins.right,
    height: margins.bottom,
  });

  // Top and bottom edges, in thirds.
  const columns: Array<[MarginBoxName, MarginBoxName]> = [
    ["top-left", "bottom-left"],
    ["top-center", "bottom-center"],
    ["top-right", "bottom-right"],
  ];
  columns.forEach(([top, bottom], index) => {
    const x = margins.left + third * index;
    rects.set(top, { x, y: topY, width: third, height: margins.top });
    rects.set(bottom, { x, y: bottomY, width: third, height: margins.bottom });
  });

  // Side edges, in thirds from the top down.
  const rows: Array<[MarginBoxName, MarginBoxName]> = [
    ["left-top", "right-top"],
    ["left-middle", "right-middle"],
    ["left-bottom", "right-bottom"],
  ];
  rows.forEach(([left, right], index) => {
    const y = margins.bottom + innerHeight - verticalThird * (index + 1);
    rects.set(left, { x: 0, y, width: margins.left, height: verticalThird });
    rects.set(right, {
      x: size.width - margins.right,
      y,
      width: margins.right,
      height: verticalThird,
    });
  });

  return rects;
}

export interface MarginBoxStyle {
  readonly fontSize: Pt;
  readonly color: MeasuredColor;
  readonly align: "left" | "center" | "right";
  readonly fontWeight: number;
  readonly fontStyle: "normal" | "italic" | "oblique";
  readonly fontFamilies: readonly string[];
}

const DEFAULT_FONT_SIZE_PT = 9;

/** Read a margin box's own styling, with sensible defaults. */
export function marginBoxStyle(
  name: MarginBoxName,
  declarations: ReadonlyMap<string, string>,
): MarginBoxStyle {
  const align = declarations.get("text-align");
  const style = declarations.get("font-style") ?? "normal";

  return {
    fontSize: declarations.has("font-size")
      ? toPt(declarations.get("font-size") as string)
      : DEFAULT_FONT_SIZE_PT,
    color: declarations.has("color")
      ? parseColor(normaliseColor(declarations.get("color") as string))
      : { r: 0, g: 0, b: 0, a: 1 },
    align:
      align === "left" || align === "center" || align === "right"
        ? align
        : defaultAlign(name),
    fontWeight: parseWeight(declarations.get("font-weight")),
    fontStyle: style === "italic" || style === "oblique" ? style : "normal",
    fontFamilies: (declarations.get("font-family") ?? "")
      .split(",")
      .map((family) => family.trim().replaceAll(/^["']|["']$/g, ""))
      .filter(Boolean),
  };
}

function parseWeight(value: string | undefined): number {
  if (!value) return 400;
  if (value === "bold") return 700;
  if (value === "normal") return 400;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 400;
}

/**
 * Convert the handful of colour keywords a margin box is likely to use.
 *
 * Declarations here are raw CSS text, not computed values, so `parseColor` —
 * which expects the computed `rgb()` form — needs help with keywords.
 */
function normaliseColor(value: string): string {
  const keywords: Record<string, string> = {
    black: "rgb(0, 0, 0)",
    white: "rgb(255, 255, 255)",
    red: "rgb(255, 0, 0)",
    green: "rgb(0, 128, 0)",
    blue: "rgb(0, 0, 255)",
    grey: "rgb(128, 128, 128)",
    gray: "rgb(128, 128, 128)",
    silver: "rgb(192, 192, 192)",
  };

  const trimmed = value.trim().toLowerCase();
  if (keywords[trimmed]) return keywords[trimmed] as string;

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const digits = hex[1] as string;
    const expand = (part: string): number => Number.parseInt(part.repeat(2 / part.length), 16);
    const parts =
      digits.length === 3
        ? [...digits].map((digit) => expand(digit))
        : [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16));
    return `rgb(${parts.join(", ")})`;
  }

  return value;
}

/** Advance width of a string, in points, from the font's own metrics. */
export function measureString(font: Font, text: string, fontSize: Pt): Pt {
  let total = 0;
  for (const character of text) {
    total += font.advanceWidth(font.glyphForCodePoint(character.codePointAt(0) as number));
  }
  return (total / 1000) * fontSize;
}

export interface MarginBoxPaintOptions {
  readonly page: PageContext;
  readonly facts: ContentFacts;
  readonly font: Font;
  readonly subset: FontSubset;
  readonly resourceName: string;
}

/**
 * Paint every margin box that has content.
 *
 * Returns the names painted, so a caller can tell whether anything was drawn.
 */
export function paintMarginBoxes(
  stream: ContentStream,
  options: MarginBoxPaintOptions,
): MarginBoxName[] {
  const rects = marginBoxRects(options.page);
  const painted: MarginBoxName[] = [];

  // Fixed order so output is deterministic regardless of declaration order.
  for (const name of MARGIN_BOX_NAMES) {
    const declarations = options.page.marginBoxes.get(name);
    if (!declarations) continue;

    const raw = declarations.get("content");
    if (raw === undefined) continue;

    const text = evaluateContent(raw, options.facts);
    if (text === "") continue;

    const rect = rects.get(name);
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;

    const style = marginBoxStyle(name, declarations);
    const width = measureString(options.font, text, style.fontSize);

    let x = rect.x;
    if (style.align === "center") x = rect.x + (rect.width - width) / 2;
    else if (style.align === "right") x = rect.x + rect.width - width;

    // Vertically centred on the box, using the font's own ascent and descent
    // rather than the line box a browser would have produced.
    const ascent = options.font.toGlyphSpace(
      options.font.os2?.typoAscender ?? options.font.hhea.ascender,
    );
    const descent = options.font.toGlyphSpace(
      Math.abs(options.font.os2?.typoDescender ?? options.font.hhea.descender),
    );
    const textHeight = ((ascent + descent) / 1000) * style.fontSize;
    const baseline = rect.y + (rect.height - textHeight) / 2 + (descent / 1000) * style.fontSize;

    const glyphs = options.subset.useText(text);

    stream.scoped((scoped) => {
      setFill(scoped, style.color);
      scoped.text((run) => {
        run
          .setFont(options.resourceName, style.fontSize)
          .moveText(x, baseline)
          .showText(encodeCids(glyphs.map((glyph) => glyph.cid)));
      });
    });

    painted.push(name);
  }

  return painted;
}
