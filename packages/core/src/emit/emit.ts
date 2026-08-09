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
  const rect = transform.rect(node.rect);

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
    if (emitLine(stream, line, emission)) {
      emitTextDecoration(stream, line, style.textDecorationLine, emission);
    }
  }
}

/** Paint a whole measured document onto a single page. */
export function paintDocument(
  page: PdfPage,
  measured: MeasuredDocument,
  context: EmissionContext,
  content: PageRect,
): void {
  const transform = new PageTransform({ content });
  paintNode(page.content, measured.root, { context, page, transform });
}
