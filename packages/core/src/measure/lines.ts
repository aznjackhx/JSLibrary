/**
 * Line and glyph-cluster extraction from text nodes.
 *
 * The browser has already decided where every line breaks and where every glyph
 * sits. This reads those decisions back out rather than re-deriving them, which
 * is the whole reason the pipeline uses a real layout engine.
 *
 * Positions come from `Range` rects. Grapheme clusters, not code points, are the
 * unit: "é" written as e + combining acute is one cluster at one x-position, and
 * splitting it would place the accent as a separate glyph.
 */

import type { BaselineProbe } from "./baseline.js";
import { round } from "./styles.js";
import type { MeasuredCluster, MeasuredLine, MeasuredRect } from "./types.js";

/** Rects within this many pixels vertically belong to the same line. */
const LINE_EPSILON = 0.5;

export interface LineMeasurementOptions {
  /** Container origin, subtracted from every rect. */
  readonly origin: { readonly x: number; readonly y: number };
  /** Record per-cluster positions. Needed by the precise text path. */
  readonly precise: boolean;
  readonly probe: BaselineProbe;
  readonly style: CSSStyleDeclaration;
}

interface ClusterSpan {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Split text into grapheme clusters.
 *
 * `Intl.Segmenter` is the correct tool and is available everywhere this library
 * runs; the code-point fallback exists so an old engine degrades to slightly
 * wrong accent placement rather than throwing.
 */
export function clusterSpans(text: string): ClusterSpan[] {
  const spans: ClusterSpan[] = [];

  const Segmenter = (globalThis as { Intl?: { Segmenter?: typeof Intl.Segmenter } }).Intl
    ?.Segmenter;

  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: "grapheme" });
    for (const segment of segmenter.segment(text)) {
      spans.push({
        text: segment.segment,
        start: segment.index,
        end: segment.index + segment.segment.length,
      });
    }
    return spans;
  }

  let index = 0;
  for (const character of text) {
    spans.push({ text: character, start: index, end: index + character.length });
    index += character.length;
  }
  return spans;
}

function toRect(rect: DOMRect, origin: { x: number; y: number }): MeasuredRect {
  return {
    x: round(rect.x - origin.x),
    y: round(rect.y - origin.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

/**
 * Measure one text node into lines.
 *
 * Returns an empty array for nodes that produce no visible text — collapsed
 * whitespace between block elements is the common case, and it is not an error.
 */
export function measureTextNode(node: Text, options: LineMeasurementOptions): MeasuredLine[] {
  const text = node.data;
  if (text.length === 0) return [];

  const doc = node.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(node);

  const nodeRects = [...range.getClientRects()].filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  if (nodeRects.length === 0) {
    range.detach();
    return [];
  }

  // Group the node's rects into lines by vertical position. A single text node
  // yields one rect per line box, but engines occasionally split further.
  const lineRects: DOMRect[] = [];
  for (const rect of nodeRects) {
    const existing = lineRects.find(
      (candidate) => Math.abs(candidate.top - rect.top) <= LINE_EPSILON,
    );
    if (!existing) {
      lineRects.push(rect);
      continue;
    }
    // Widen the existing line to cover this fragment.
    const left = Math.min(existing.left, rect.left);
    const right = Math.max(existing.right, rect.right);
    const top = Math.min(existing.top, rect.top);
    const bottom = Math.max(existing.bottom, rect.bottom);
    lineRects[lineRects.indexOf(existing)] = new DOMRect(left, top, right - left, bottom - top);
  }

  lineRects.sort((a, b) => a.top - b.top || a.left - b.left);

  const { ascent } = options.probe.forStyle(options.style);

  // Assign every cluster to a line by its own rect, then rebuild the line's
  // text from the clusters that landed on it. Reading the text back this way
  // means soft wrapping is reported exactly as the browser performed it.
  const buckets = lineRects.map<{ text: string; clusters: MeasuredCluster[] }>(() => ({
    text: "",
    clusters: [],
  }));

  let lastLineIndex = 0;

  for (const span of clusterSpans(text)) {
    range.setStart(node, span.start);
    range.setEnd(node, span.end);
    const rect = range.getBoundingClientRect();

    // Collapsed whitespace has no box. It still belongs to the line it follows
    // — dropping it would join words in the extracted text — but there is no
    // position to record for it.
    if (rect.width === 0 && rect.height === 0) {
      const bucket = buckets[lastLineIndex];
      if (bucket && bucket.text.length > 0) bucket.text += span.text;
      continue;
    }

    let lineIndex = lineRects.findIndex(
      (candidate) => Math.abs(candidate.top - rect.top) <= LINE_EPSILON,
    );
    if (lineIndex === -1) {
      // Superscripts and inline images can sit off the line's own top; fall
      // back to the line whose vertical span contains this rect's centre.
      const centre = rect.top + rect.height / 2;
      lineIndex = lineRects.findIndex(
        (candidate) => centre >= candidate.top && centre <= candidate.bottom,
      );
    }
    if (lineIndex === -1) continue;

    const bucket = buckets[lineIndex];
    if (!bucket) continue;

    lastLineIndex = lineIndex;
    bucket.text += span.text;
    bucket.clusters.push({
      text: span.text,
      x: round(rect.x - options.origin.x),
      width: round(rect.width),
    });
  }

  range.detach();

  const lines: MeasuredLine[] = [];

  lineRects.forEach((rect, index) => {
    const bucket = buckets[index];
    if (!bucket || bucket.text.length === 0) return;

    const measured = toRect(rect, options.origin);
    const line: MeasuredLine = {
      text: bucket.text,
      rect: measured,
      baseline: round(measured.y + ascent),
      ...(options.precise ? { clusters: bucket.clusters } : {}),
    };
    lines.push(line);
  });

  return lines;
}
