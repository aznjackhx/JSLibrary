/**
 * Text emission.
 *
 * Two modes, as the brief requires.
 *
 * *Fast* places the pen once per line and lets PDF advance widths carry the
 * rest. It is smaller and quicker, and it is correct only insofar as the font's
 * own advances agree with what the browser did — which they will not once
 * kerning, ligatures or letter-spacing are in play.
 *
 * *Precise* pins every cluster to the x the browser measured, by emitting
 * explicit adjustments in a `TJ` array. This is the default: the whole premise
 * of using a real layout engine is that its positions are the truth, and
 * throwing them away at the last step would be perverse.
 */

import type { FontSubset } from "../fonts/font.js";
import { encodeCids } from "../fonts/embed.js";
import type { ContentStream, TextItem } from "../pdf/content.js";
import type { MeasuredLine, MeasuredColor } from "../measure/types.js";
import { round } from "../units.js";
import { setFill } from "./paint.js";
import type { PageTransform } from "./transform.js";

/**
 * Adjustments below this are dropped.
 *
 * `TJ` numbers are thousandths of an em; a tenth of one of those is far below
 * any device resolution, and emitting them would bloat the stream with noise
 * from floating-point subtraction.
 */
const ADJUSTMENT_EPSILON = 0.1;

export interface TextEmissionOptions {
  readonly subset: FontSubset;
  readonly resourceName: string;
  /** Font size in points. */
  readonly fontSize: number;
  readonly color: MeasuredColor;
  readonly transform: PageTransform;
  readonly precise: boolean;
}

/**
 * Emit one laid-out line.
 *
 * Returns false when the line contributes nothing, so callers can skip opening
 * a text object for it.
 */
export function emitLine(
  stream: ContentStream,
  line: MeasuredLine,
  options: TextEmissionOptions,
): boolean {
  const { subset, transform, fontSize } = options;
  if (line.text.length === 0) return false;

  const baselineY = transform.y(line.baseline);
  const startX = transform.x(line.rect.x);

  if (!options.precise || !line.clusters || line.clusters.length === 0) {
    const glyphs = subset.useText(line.text);
    if (glyphs.length === 0) return false;

    stream.scoped((scoped) => {
      setFill(scoped, options.color);
      scoped.text((text) => {
        text
          .setFont(options.resourceName, fontSize)
          .moveText(startX, baselineY)
          .showText(encodeCids(glyphs.map((glyph) => glyph.cid)));
      });
    });
    return true;
  }

  const items = buildPreciseRun(line, options);
  if (items.length === 0) return false;

  stream.scoped((scoped) => {
    setFill(scoped, options.color);
    scoped.text((text) => {
      text
        .setFont(options.resourceName, fontSize)
        .moveText(startX, baselineY)
        .showTextArray(items);
    });
  });
  return true;
}

/**
 * Build the `TJ` array for a line, pinning each cluster to its measured x.
 *
 * The pen starts at the line's left edge. After showing a glyph it has advanced
 * by the font's own width for that glyph; a `TJ` number moves it back by that
 * many thousandths of an em. So to land the next cluster where the browser put
 * it, the adjustment is the difference between where the pen is and where the
 * cluster should start — negated, because positive numbers move the pen left.
 */
export function buildPreciseRun(
  line: MeasuredLine,
  options: TextEmissionOptions,
): TextItem[] {
  const { subset, transform, fontSize } = options;
  const clusters = line.clusters ?? [];

  const items: TextItem[] = [];
  let pending: number[] = [];

  // Pen position in PDF points, tracked as the viewer would.
  let penX = transform.x(line.rect.x);

  const flush = (): void => {
    if (pending.length === 0) return;
    items.push(encodeCids(pending));
    pending = [];
  };

  for (const cluster of clusters) {
    const targetX = transform.x(cluster.x);
    const shift = targetX - penX;
    const adjustment = -(shift / fontSize) * 1000;

    if (Math.abs(adjustment) >= ADJUSTMENT_EPSILON) {
      flush();
      items.push(round(adjustment, 2));
      penX = targetX;
    }

    // A cluster can be several code points — a base plus combining marks — and
    // each one is its own glyph sharing the cluster's position.
    for (const glyph of subset.useText(cluster.text)) {
      pending.push(glyph.cid);
      penX += (glyph.width / 1000) * fontSize;
    }
  }

  flush();
  return items;
}

/**
 * Paint underline and line-through.
 *
 * Positions are derived from the line box rather than from font metrics: the
 * browser has already decided where the line sits, and matching it matters more
 * than matching the font's own suggestion.
 */
export function emitTextDecoration(
  stream: ContentStream,
  line: MeasuredLine,
  decorationLine: string,
  options: TextEmissionOptions,
): void {
  if (decorationLine === "none" || decorationLine === "") return;

  const { transform, fontSize, color } = options;
  const thickness = Math.max(fontSize / 14, 0.4);
  const left = transform.x(line.rect.x);
  const width = transform.length(line.rect.width);
  if (width <= 0) return;

  const baselineY = transform.y(line.baseline);

  const draw = (y: number): void => {
    stream.scoped((scoped) => {
      setFill(scoped, color);
      scoped.rect(left, y, width, thickness).fill();
    });
  };

  if (decorationLine.includes("underline")) {
    draw(baselineY - fontSize * 0.11);
  }
  if (decorationLine.includes("line-through")) {
    draw(baselineY + fontSize * 0.22);
  }
  if (decorationLine.includes("overline")) {
    draw(baselineY + fontSize * 0.75);
  }
}
