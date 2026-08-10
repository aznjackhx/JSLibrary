/**
 * Links, anchors and destinations.
 *
 * A PDF link is an annotation: a rectangle on a page plus an action. The work
 * is almost entirely in the rectangle. An `<a>` is an inline box, so a link
 * that wraps across two lines is two rectangles, not one — using the element's
 * bounding box instead would make the whole paragraph clickable, which is the
 * bug every naive implementation ships with.
 */

import type { MeasuredElement, MeasuredNode, MeasuredRect } from "../measure/types.js";
import { dict, name, PdfDict, textString, type PdfValue } from "../pdf/objects.js";
import type { PdfPage } from "../pdf/document.js";
import type { Rect as PageRect } from "../page/geometry.js";
import type { PageTransform } from "./transform.js";

/** A link found in the measured tree. */
export interface MeasuredLink {
  /** The href exactly as authored, so a fragment stays recognisable. */
  readonly href: string;
  /** The same href resolved against the document's base URL. */
  readonly resolved: string;
  /** One rect per line box the link occupies. */
  readonly rects: readonly MeasuredRect[];
}

/** Somewhere in the document a link can point at. */
export interface MeasuredAnchor {
  readonly id: string;
  readonly rect: MeasuredRect;
}

/**
 * The rectangles a link occupies.
 *
 * Line boxes where the link has text, and the element's own box otherwise —
 * an `<a>` wrapping an image has no lines of its own but is still clickable.
 */
function linkRects(element: MeasuredElement): MeasuredRect[] {
  const rects: MeasuredRect[] = [];

  const collect = (node: MeasuredNode): void => {
    if (node.kind === "text") {
      for (const line of node.lines) {
        if (line.rect.width > 0 && line.rect.height > 0) rects.push(line.rect);
      }
      return;
    }
    for (const child of node.children) collect(child);
  };
  collect(element);

  if (rects.length > 0) return rects;
  return element.rect.width > 0 && element.rect.height > 0 ? [element.rect] : [];
}

/** Every link in a measured tree, in document order. */
export function collectLinks(root: MeasuredElement): MeasuredLink[] {
  const links: MeasuredLink[] = [];

  const visit = (node: MeasuredNode): void => {
    if (node.kind === "text") return;

    if (node.href !== undefined && node.href !== "") {
      const rects = linkRects(node);
      if (rects.length > 0) {
        links.push({
          href: node.href,
          resolved: node.hrefResolved ?? node.href,
          rects,
        });
      }
      // A nested <a> is invalid HTML and a browser will not produce one, so
      // there is nothing to look for inside.
      return;
    }

    for (const child of node.children) visit(child);
  };
  visit(root);

  return links;
}

/** Every element carrying an id, in document order. */
export function collectAnchors(root: MeasuredElement): MeasuredAnchor[] {
  const anchors: MeasuredAnchor[] = [];

  const visit = (node: MeasuredNode): void => {
    if (node.kind === "text") return;
    if (node.id !== undefined && node.id !== "") anchors.push({ id: node.id, rect: node.rect });
    for (const child of node.children) visit(child);
  };
  visit(root);

  return anchors;
}

/** Is this href a reference to somewhere in the same document? */
export function isFragment(href: string): boolean {
  return href.startsWith("#") && href.length > 1;
}

/** The id an in-document href names, decoded. */
export function fragmentId(href: string): string {
  const raw = href.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // A malformed escape is more useful matched literally.
  }
}

/**
 * Where on a page a destination lands.
 *
 * `/XYZ` with a null zoom means "put this point at the top left of the window
 * and leave the zoom alone", which is the least intrusive thing a jump can do.
 */
export function destination(page: PdfPage, left: number, top: number): PdfValue[] {
  return [page.ref, name("XYZ"), left, top, null];
}

/** Clip a measured rect to the vertical band a page shows. */
function clipToBand(
  rect: MeasuredRect,
  band: { top: number; bottom: number },
): MeasuredRect | undefined {
  const top = Math.max(rect.y, band.top);
  const bottom = Math.min(rect.y + rect.height, band.bottom);
  if (bottom - top <= 0) return undefined;
  return { ...rect, y: top, height: bottom - top };
}

/** A PDF rectangle array, lower-left then upper-right. */
function rectArray(rect: PageRect): number[] {
  return [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
}

export interface LinkAnnotationOptions {
  readonly transform: PageTransform;
  readonly band: { readonly top: number; readonly bottom: number };
  /** Resolves an in-document href to a destination, when the target is known. */
  readonly resolveFragment: (id: string) => PdfValue[] | undefined;
}

/**
 * Build the link annotations for one page.
 *
 * A link crossing a page boundary contributes a rectangle to each page it
 * touches, clipped to that page — both halves stay clickable.
 */
export function linkAnnotations(
  links: readonly MeasuredLink[],
  options: LinkAnnotationOptions,
): PdfDict[] {
  const annotations: PdfDict[] = [];

  for (const link of links) {
    const action = actionFor(link, options.resolveFragment);
    if (!action) continue;

    for (const rect of link.rects) {
      const clipped = clipToBand(rect, options.band);
      if (!clipped) continue;

      annotations.push(
        dict({
          Type: name("Annot"),
          Subtype: name("Link"),
          Rect: rectArray(options.transform.rect(clipped)),
          // Without this a viewer draws its own border around every link.
          Border: [0, 0, 0],
          // Print the annotation, and let a viewer decide it is not a widget.
          F: 4,
          A: action,
        }),
      );
    }
  }

  return annotations;
}

/**
 * The action a link performs.
 *
 * An in-document link whose target was never measured produces no annotation
 * at all: a link that goes nowhere is worse than no link, because a reader
 * cannot tell it is broken until they click it.
 */
function actionFor(
  link: MeasuredLink,
  resolveFragment: (id: string) => PdfValue[] | undefined,
): PdfDict | undefined {
  if (isFragment(link.href)) {
    const target = resolveFragment(fragmentId(link.href));
    if (!target) return undefined;
    return dict({ S: name("GoTo"), D: target });
  }

  // A bare "#" is a placeholder, not a destination.
  if (link.href === "#") return undefined;

  return dict({ S: name("URI"), URI: textString(link.resolved) });
}
