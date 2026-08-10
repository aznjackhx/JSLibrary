/**
 * The document outline — what a viewer shows as bookmarks.
 *
 * Built from heading hierarchy, because that is the structure a document
 * already has. `h1`..`h6` give the nesting directly; a level that skips a rank
 * (an `h3` under an `h1`) nests under whatever is open rather than inventing an
 * empty `h2`, which is what a reader expects and what a strict reading of the
 * levels would get wrong.
 *
 * Every entry in the tree cross-references its parent, its siblings and its
 * children, so object numbers are reserved before any of them is filled in.
 */

import type { MeasuredElement, MeasuredNode } from "../measure/types.js";
import type { PdfDocument } from "../pdf/document.js";
import { dict, name, textString, type PdfRef, type PdfValue } from "../pdf/objects.js";

/** A heading found in the measured tree. */
export interface MeasuredHeading {
  /** 1 for `h1`, 6 for `h6`. */
  readonly level: number;
  readonly text: string;
  /** Vertical position in the measured column, in CSS pixels. */
  readonly y: number;
  /** Left edge, for the destination this heading jumps to. */
  readonly x: number;
}

const HEADING_TAGS = new Map<string, number>([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
  ["h4", 4],
  ["h5", 5],
  ["h6", 6],
]);

/** All the text inside a node, collapsed the way a title should read. */
function textOf(node: MeasuredNode): string {
  if (node.kind === "text") return node.text;
  return node.children.map(textOf).join("");
}

/** Every heading in a measured tree, in document order. */
export function collectHeadings(root: MeasuredElement): MeasuredHeading[] {
  const headings: MeasuredHeading[] = [];

  const visit = (node: MeasuredNode): void => {
    if (node.kind === "text") return;

    const level = HEADING_TAGS.get(node.tag);
    if (level !== undefined) {
      const text = textOf(node).replaceAll(/\s+/g, " ").trim();
      // A heading with no text would be an unlabelled bookmark, which is worse
      // than no bookmark at all.
      if (text !== "") {
        headings.push({ level, text, y: node.rect.y, x: node.rect.x });
      }
      return;
    }

    for (const child of node.children) visit(child);
  };
  visit(root);

  return headings;
}

/** A heading with its children, ready to be written. */
export interface OutlineNode {
  readonly heading: MeasuredHeading;
  readonly children: OutlineNode[];
}

/**
 * Nest a flat list of headings by level.
 *
 * A heading nests under the nearest preceding heading of a lower level. That
 * rule handles skipped levels and out-of-order documents without special cases:
 * anything with no shallower heading before it becomes a root.
 */
export function buildOutlineTree(headings: readonly MeasuredHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const heading of headings) {
    const node: OutlineNode = { heading, children: [] };

    while (stack.length > 0 && (stack[stack.length - 1] as OutlineNode).heading.level >= heading.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);

    stack.push(node);
  }

  return roots;
}

/** Total number of entries in a subtree, counting the roots themselves. */
function countAll(nodes: readonly OutlineNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countAll(node.children), 0);
}

export interface OutlineOptions {
  /** The destination a heading at this position jumps to. */
  readonly destinationFor: (heading: MeasuredHeading) => PdfValue[] | undefined;
}

/**
 * Write an outline tree and return the reference for the catalog.
 *
 * Returns undefined when there is nothing to write, so a document with no
 * headings gets no `/Outlines` entry rather than an empty one.
 */
export function writeOutline(
  pdf: PdfDocument,
  roots: readonly OutlineNode[],
  options: OutlineOptions,
): PdfRef | undefined {
  if (roots.length === 0) return undefined;

  const rootRef = pdf.reserve();

  const writeLevel = (nodes: readonly OutlineNode[], parent: PdfRef): {
    first: PdfRef;
    last: PdfRef;
  } => {
    const refs = nodes.map(() => pdf.reserve());

    nodes.forEach((node, index) => {
      const self = refs[index] as PdfRef;
      const entry = dict({
        Title: textString(node.heading.text),
        Parent: parent,
      });

      const previous = refs[index - 1];
      if (previous) entry.set("Prev", previous);
      const next = refs[index + 1];
      if (next) entry.set("Next", next);

      if (node.children.length > 0) {
        const { first, last } = writeLevel(node.children, self);
        entry.set("First", first);
        entry.set("Last", last);
        // Positive: the subtree is open, so a viewer shows it expanded.
        entry.set("Count", countAll(node.children));
      }

      const target = options.destinationFor(node.heading);
      // A heading that fell on no page has nowhere to jump to; the entry still
      // appears, so the outline keeps its shape.
      if (target) entry.set("Dest", target);

      pdf.assign(self, entry);
    });

    return { first: refs[0] as PdfRef, last: refs[refs.length - 1] as PdfRef };
  };

  const { first, last } = writeLevel(roots, rootRef);

  pdf.assign(
    rootRef,
    dict({
      Type: name("Outlines"),
      First: first,
      Last: last,
      Count: countAll(roots),
    }),
  );

  return rootRef;
}
