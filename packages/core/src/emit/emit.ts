/**
 * The orchestrator: measured geometry in, painted page out.
 *
 * Paint order follows the tree. An element paints its own background and
 * borders, then its children, which is the order CSS specifies for
 * non-positioned content and the reason nested cards stack correctly without
 * any explicit z-handling.
 */

import { embedFontSubset } from "../fonts/embed.js";
import type { Font, FontSubset } from "../fonts/font.js";
import type { FontRegistry } from "../fonts/resolve.js";
import { parseFontFamilyList, type FontStyle } from "../fonts/resolve.js";
import type { CapturedImage } from "../measure/images.js";
import type {
  CapturedStyle,
  MeasuredDocument,
  MeasuredElement,
  MeasuredNode,
} from "../measure/types.js";
import type { ContentStream } from "../pdf/content.js";
import type { PdfDocument, PdfPage } from "../pdf/document.js";
import { dict, name, type PdfRef } from "../pdf/objects.js";
import type { Rect as PageRect } from "../page/geometry.js";
import { drawImage, embedImage, type EmbeddedImage } from "./images.js";
import { paintBackground, paintBorders } from "./paint.js";
import { emitLine, emitTextDecoration } from "./text.js";
import { PageTransform } from "./transform.js";

export interface EmitOptions {
  readonly document: PdfDocument;
  readonly registry: FontRegistry;
  readonly images: ReadonlyMap<string, CapturedImage>;
  readonly precise: boolean;
}

/**
 * Per-document emission state.
 *
 * Font subsets accumulate across every page: one subset per face for the whole
 * document, not one per page, so a font used throughout is embedded once.
 */
export class EmissionContext {
  readonly document: PdfDocument;
  readonly registry: FontRegistry;
  readonly images: ReadonlyMap<string, CapturedImage>;
  readonly precise: boolean;

  readonly #subsets = new Map<Font, FontSubset>();
  readonly #embeddedImages = new Map<string, EmbeddedImage>();
  /** Font object per face, filled in by finish(). */
  readonly #fontRefs = new Map<Font, PdfRef>();
  /** Reserved resource names per page, bound once the objects exist. */
  readonly #pageFonts = new Map<PdfPage, Map<Font, string>>();
  #finished = false;

  constructor(options: EmitOptions) {
    this.document = options.document;
    this.registry = options.registry;
    this.images = options.images;
    this.precise = options.precise;
  }

  /** The subset accumulating for a face, created on first use. */
  subsetFor(font: Font): FontSubset {
    let subset = this.#subsets.get(font);
    if (!subset) {
      subset = font.createSubset();
      this.#subsets.set(font, subset);
    }
    return subset;
  }

  /** Resolve a measured style to a font face. */
  fontFor(style: CapturedStyle): Font {
    return this.registry.resolveOrFallback({
      families: parseFontFamilyList(style.fontFamily),
      weight: style.fontWeight,
      style: normaliseFontStyle(style.fontStyle),
    });
  }

  imageFor(reference: string): EmbeddedImage | undefined {
    const existing = this.#embeddedImages.get(reference);
    if (existing) return existing;

    const captured = this.images.get(reference);
    if (!captured) return undefined;

    const embedded = embedImage(this.document, captured);
    this.#embeddedImages.set(reference, embedded);
    return embedded;
  }

  /**
   * Write the font programs.
   *
   * Deferred to the end because a subset is only complete once every page that
   * uses it has been emitted — embedding earlier would omit glyphs that appear
   * later in the document.
   */
  finish(): void {
    if (this.#finished) return;
    this.#finished = true;

    for (const [font, subset] of this.#subsets) {
      if (subset.glyphCount <= 1) continue; // Nothing but .notdef was used.
      const embedded = embedFontSubset(this.document, font, subset.build());
      this.#fontRefs.set(font, embedded.ref);
    }

    // Resource dictionaries were populated with placeholders while pages were
    // emitted; now that the real objects exist, point them at those.
    for (const [page, uses] of this.#pageFonts) {
      for (const [font, resourceName] of uses) {
        const ref = this.#fontRefs.get(font);
        if (ref) page.resources.assign("Font", resourceName, ref);
      }
    }
  }

  /**
   * The resource name a page should use for a face, allocating one if needed.
   *
   * The underlying object does not exist yet — see `finish()` — so a name is
   * reserved now and bound later.
   */
  resourceNameFor(page: PdfPage, font: Font): string {
    let uses = this.#pageFonts.get(page);
    if (!uses) {
      uses = new Map();
      this.#pageFonts.set(page, uses);
    }

    const existing = uses.get(font);
    if (existing) return existing;

    const resourceName = page.resources.reserve("Font");
    uses.set(font, resourceName);
    return resourceName;
  }
}

function normaliseFontStyle(value: string): FontStyle {
  if (value.startsWith("italic")) return "italic";
  if (value.startsWith("oblique")) return "oblique";
  return "normal";
}

/** Should this element's own box be painted at all? */
function paintsBox(style: CapturedStyle): boolean {
  return style.visibility !== "hidden";
}

export interface PaintOptions {
  readonly context: EmissionContext;
  readonly page: PdfPage;
  readonly transform: PageTransform;
  /**
   * The slice of measured content this page shows, in CSS pixels from the top
   * of the measured column. Anything outside it belongs to another page.
   */
  readonly band: PageBand;
}

/** A half-open vertical range of measured content: `[top, bottom)`. */
export interface PageBand {
  readonly top: number;
  readonly bottom: number;
}

/** Does a measured rect touch this band at all? */
function intersectsBand(rect: { y: number; height: number }, band: PageBand): boolean {
  return rect.y < band.bottom && rect.y + rect.height > band.top;
}

/**
 * Cut a rect down to the part of it this page shows.
 *
 * Used for `box-decoration-break: clone`, where the fragment on each page is
 * drawn as a complete box rather than as a slice of a taller one.
 */
function clampToBand<T extends { y: number; height: number }>(rect: T, band: PageBand): T {
  const top = Math.max(rect.y, band.top);
  const bottom = Math.min(rect.y + rect.height, band.bottom);
  return { ...rect, y: top, height: Math.max(bottom - top, 0) };
}

/** Paint a measured subtree onto a page. */
export function paintNode(
  stream: ContentStream,
  node: MeasuredNode,
  options: PaintOptions,
): void {
  if (node.kind === "text") return; // Text is painted by its parent element.

  const { transform, context } = options;
  const style = node.style;

  // An element wholly above or below this page contributes nothing to it. Its
  // descendants are inside its box, so the whole subtree can be skipped.
  if (!intersectsBand(node.rect, options.band)) return;

  // `slice`, the CSS default, draws the box as though it were continuous and
  // then cut — which is exactly what clipping to the page already produces, so
  // there is nothing to do. `clone` closes the box on each fragment, which
  // means painting the part on this page as a box in its own right.
  const decorated =
    style.boxDecorationBreak === "clone" ? clampToBand(node.rect, options.band) : node.rect;

  const rect = transform.rect(decorated);

  const opaque = style.opacity >= 1;

  const paintContents = (target: ContentStream): void => {
    if (paintsBox(style)) {
      paintBackground(target, rect, style, transform);
      paintBorders(target, rect, style, transform);
      paintImage(target, node, options);
    }

    for (const child of node.children) {
      if (child.kind === "text") {
        paintText(target, node, child, options);
      } else {
        paintNode(target, child, options);
      }
    }
  };

  if (opaque) {
    paintContents(stream);
    return;
  }

  // Group opacity applies to the subtree as a whole, so it is pushed once
  // around everything rather than multiplied into each colour.
  const graphicsState = context.document.add(
    dict({ Type: name("ExtGState"), ca: style.opacity, CA: style.opacity }),
  );
  const resourceName = options.page.resources.register("ExtGState", graphicsState);

  stream.scoped((scoped) => {
    scoped.setExtGState(resourceName);
    paintContents(scoped);
  });
}

function paintImage(
  stream: ContentStream,
  node: MeasuredElement,
  options: PaintOptions,
): void {
  if (!node.imageRef) return;

  const embedded = options.context.imageFor(node.imageRef);
  if (!embedded) return;

  const resourceName = options.page.resources.register("XObject", embedded.ref);
  // Images fill the element's content box, which is where the browser drew it.
  drawImage(stream, resourceName, options.transform.rect(node.contentRect));
}

function paintText(
  stream: ContentStream,
  parent: MeasuredElement,
  text: Extract<MeasuredNode, { kind: "text" }>,
  options: PaintOptions,
): void {
  const { context, page, transform } = options;
  const style = parent.style;

  if (style.visibility === "hidden" || style.color.a === 0) return;

  const font = context.fontFor(style);
  const subset = context.subsetFor(font);
  const resourceName = context.resourceNameFor(page, font);
  const fontSize = transform.length(style.fontSize);

  const emission = {
    subset,
    resourceName,
    fontSize,
    color: style.color,
    transform,
    precise: context.precise,
  };

  for (const line of text.lines) {
    // Assigned by its top edge, so a line is painted on exactly one page: never
    // dropped between two, never counted twice by text extraction. Until break
    // positions are chosen (5.2) a line straddling the boundary is clipped at
    // the page edge rather than moved, which is visible and deliberate.
    if (!ownsLine(line, options.band)) continue;

    if (emitLine(stream, line, emission)) {
      emitTextDecoration(stream, line, style.textDecorationLine, emission);
    }
  }
}

/**
 * Which page owns a line.
 *
 * The top edge decides. Using the baseline instead would move a line to the
 * next page while its ascenders stayed on this one.
 */
export function ownsLine(line: { rect: { y: number } }, band: PageBand): boolean {
  return line.rect.y >= band.top && line.rect.y < band.bottom;
}

/** Paint one page's worth of a measured document. */
export function paintPage(
  page: PdfPage,
  measured: MeasuredDocument,
  context: EmissionContext,
  content: PageRect,
  band: PageBand,
): void {
  const transform = new PageTransform({ content, scrollY: band.top });

  // Everything is clipped to the content box: a box taller than the page must
  // stop at the margin rather than bleed across it.
  page.content.save();
  page.content.clipRect(content.x, content.y, content.width, content.height);
  paintNode(page.content, measured.root, { context, page, transform, band });
  page.content.restore();
}
