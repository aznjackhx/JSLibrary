/**
 * The tree walk: turn a laid-out subtree into measured geometry.
 *
 * Everything read here comes from the browser after layout has settled. Nothing
 * is computed, inferred, or laid out again — that is the point of the approach.
 */

import { BaselineProbe } from "./baseline.js";
import { captureImage, type CapturedImage } from "./images.js";
import { measureTextNode } from "./lines.js";
import type { StringAssignment, StringSetRule } from "../page/string-set.js";
import { evaluateStringSetValue } from "../page/string-set.js";
import { captureStyle, round } from "./styles.js";
import type { MeasuredElement, MeasuredNode, MeasuredRect } from "./types.js";

export interface WalkOptions {
  readonly origin: { readonly x: number; readonly y: number };
  readonly probe: BaselineProbe;
  /** Record per-cluster x positions. Default true, matching the precise text path. */
  readonly precise: boolean;
  /**
   * Collects image pixels as they are captured. Populated by the walk, since
   * the DOM is the only place these can be read from.
   */
  readonly images: Map<string, CapturedImage>;
  /**
   * Clone image to the loaded original. A cloned image may still be decoding,
   * and reading pixels from it would yield nothing.
   */
  readonly sourceImages: ReadonlyMap<Element, HTMLImageElement>;
  /**
   * `string-set` rules to match elements against, and the assignments they
   * produce. Matching happens here because it needs the live element; the
   * order the walk visits in is document order, which is what named strings
   * are resolved against.
   */
  readonly stringSet?: {
    readonly rules: readonly StringSetRule[];
    readonly assignments: StringAssignment[];
  };
}

/** Elements that never contribute to output. */
const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template", "link", "meta", "title"]);

function relativeRect(rect: DOMRect, origin: { x: number; y: number }): MeasuredRect {
  return {
    x: round(rect.x - origin.x),
    y: round(rect.y - origin.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

/**
 * Content box of an element, derived from its border box.
 *
 * `getBoundingClientRect` reports the border box; the content box is what text
 * and children are laid out into, and fragmentation reasons about both.
 */
function contentRect(
  border: MeasuredRect,
  style: ReturnType<typeof captureStyle>,
): MeasuredRect {
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] = style.padding;
  const left = border.x + style.borderLeft.width + paddingLeft;
  const top = border.y + style.borderTop.width + paddingTop;
  const width =
    border.width - style.borderLeft.width - style.borderRight.width - paddingLeft - paddingRight;
  const height =
    border.height - style.borderTop.width - style.borderBottom.width - paddingTop - paddingBottom;

  return {
    x: round(left),
    y: round(top),
    width: round(Math.max(width, 0)),
    height: round(Math.max(height, 0)),
  };
}

/**
 * True when an element contributes nothing and can be pruned along with its
 * subtree.
 *
 * `visibility: hidden` is deliberately *not* pruned here: it hides the element
 * but its descendants can set `visibility: visible` and become visible again.
 */
function isSkipped(element: Element, style: CSSStyleDeclaration): boolean {
  if (SKIPPED_TAGS.has(element.tagName.toLowerCase())) return true;
  if (style.display === "none") return true;
  return false;
}

export function walkElement(element: Element, options: WalkOptions): MeasuredElement | undefined {
  const view = element.ownerDocument.defaultView;
  if (!view) return undefined;

  const computed = view.getComputedStyle(element);
  if (isSkipped(element, computed)) return undefined;

  const style = captureStyle(computed);
  const border = relativeRect(element.getBoundingClientRect(), options.origin);

  // Recorded before descending, so assignments come out in document order.
  if (options.stringSet) {
    for (const rule of options.stringSet.rules) {
      let matched = false;
      try {
        matched = element.matches(rule.selector);
      } catch {
        continue; // A selector the engine cannot parse matches nothing.
      }
      if (!matched) continue;

      const value = evaluateStringSetValue(rule.value, element);
      options.stringSet.assignments.push({ name: rule.name, value, y: border.y });
    }
  }

  const children: MeasuredNode[] = [];

  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const lines = measureTextNode(child as Text, {
        origin: options.origin,
        precise: options.precise,
        probe: options.probe,
        // Text inherits its font from the containing element.
        style: computed,
      });
      if (lines.length > 0) {
        children.push({ kind: "text", text: (child as Text).data, lines });
      }
      continue;
    }

    if (child.nodeType === Node.ELEMENT_NODE) {
      const measured = walkElement(child as Element, options);
      if (measured) children.push(measured);
    }
  }

  const anchor = element instanceof view.HTMLAnchorElement ? element : undefined;
  const image = element instanceof view.HTMLImageElement ? element : undefined;

  // Pixels have to be read now: emission runs against plain data, with no DOM
  // left to read from.
  let imageRef: string | undefined;
  if (image) {
    // Read from the original where one exists: the clone may still be loading.
    const captured = captureImage(options.sourceImages.get(element) ?? image);
    if (captured) {
      imageRef = `image-${options.images.size + 1}`;
      options.images.set(imageRef, captured);
    }
  }

  return {
    kind: "element",
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classes: [...element.classList],
    rect: border,
    contentRect: contentRect(border, style),
    style,
    src: image?.currentSrc || image?.src || undefined,
    imageRef,
    href: anchor?.getAttribute("href") ?? undefined,
    // The IDL property resolves against the document's base URL, which is what
    // a URI action needs — a relative href would be meaningless once the PDF
    // has left the site it was rendered on.
    hrefResolved: anchor?.href || undefined,
    children,
  };
}

export { BaselineProbe };
