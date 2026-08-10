import { describe, expect, it } from "vitest";

import { buildOutlineTree, writeOutline, type MeasuredHeading } from "../src/emit/outline.js";
import { PdfDocument } from "../src/pdf/document.js";
import { PdfDict, PdfLiteralString, PdfRef } from "../src/pdf/objects.js";

const heading = (level: number, text: string, y = 0): MeasuredHeading => ({
  level,
  text,
  y,
  x: 0,
});

/** Titles of a tree, nested the way the outline will be. */
function shape(nodes: ReturnType<typeof buildOutlineTree>): unknown {
  return nodes.map((node) => ({
    title: node.heading.text,
    children: shape(node.children),
  }));
}

describe("buildOutlineTree", () => {
  it("nests by heading level", () => {
    const tree = buildOutlineTree([
      heading(1, "One"),
      heading(2, "One.A"),
      heading(2, "One.B"),
      heading(1, "Two"),
    ]);

    expect(shape(tree)).toEqual([
      {
        title: "One",
        children: [
          { title: "One.A", children: [] },
          { title: "One.B", children: [] },
        ],
      },
      { title: "Two", children: [] },
    ]);
  });

  it("nests a skipped level under whatever is open", () => {
    // An h3 directly under an h1 is common and not an error; inventing an
    // empty h2 to hold it would put a blank entry in the reader's sidebar.
    const tree = buildOutlineTree([heading(1, "One"), heading(3, "Deep")]);

    expect(shape(tree)).toEqual([
      { title: "One", children: [{ title: "Deep", children: [] }] },
    ]);
  });

  it("treats a document that starts deep as a set of roots", () => {
    const tree = buildOutlineTree([heading(3, "A"), heading(3, "B")]);

    expect(shape(tree)).toEqual([
      { title: "A", children: [] },
      { title: "B", children: [] },
    ]);
  });

  it("closes a subtree when the level rises again", () => {
    const tree = buildOutlineTree([
      heading(1, "One"),
      heading(3, "Deep"),
      heading(2, "Back"),
    ]);

    expect(shape(tree)).toEqual([
      {
        title: "One",
        children: [
          { title: "Deep", children: [] },
          { title: "Back", children: [] },
        ],
      },
    ]);
  });

  it("produces nothing from no headings", () => {
    expect(buildOutlineTree([])).toEqual([]);
  });
});

describe("writeOutline", () => {
  const dest = (): number[] => [0, 0, 0];

  it("writes nothing for a document with no headings", () => {
    const pdf = new PdfDocument();
    expect(writeOutline(pdf, [], { destinationFor: dest })).toBeUndefined();
  });

  it("links siblings both ways and points them at their parent", () => {
    const pdf = new PdfDocument();
    const tree = buildOutlineTree([heading(1, "One"), heading(2, "A"), heading(2, "B")]);
    const rootRef = writeOutline(pdf, tree, { destinationFor: dest }) as PdfRef;

    pdf.addPage({ width: 100, height: 100 });
    const bytes = pdf.toBytes();
    expect(bytes.length).toBeGreaterThan(0);

    const root = objectAt(pdf, rootRef);
    const one = objectAt(pdf, root.get("First") as PdfRef);
    const a = objectAt(pdf, one.get("First") as PdfRef);
    const b = objectAt(pdf, one.get("Last") as PdfRef);

    expect(titleOf(a)).toBe("A");
    expect((a.get("Next") as PdfRef).num).toBe((one.get("Last") as PdfRef).num);
    expect((b.get("Prev") as PdfRef).num).toBe((one.get("First") as PdfRef).num);
    expect((a.get("Parent") as PdfRef).num).toBe((root.get("First") as PdfRef).num);
    // The first child has nothing before it and the last nothing after it.
    expect(a.has("Prev")).toBe(false);
    expect(b.has("Next")).toBe(false);
  });

  it("counts descendants so a viewer shows the tree open", () => {
    const pdf = new PdfDocument();
    const tree = buildOutlineTree([heading(1, "One"), heading(2, "A"), heading(2, "B")]);
    const rootRef = writeOutline(pdf, tree, { destinationFor: dest }) as PdfRef;

    const root = objectAt(pdf, rootRef);
    const one = objectAt(pdf, root.get("First") as PdfRef);

    expect(root.get("Count")).toBe(3);
    expect(one.get("Count")).toBe(2);
  });

  it("keeps an entry whose heading landed on no page", () => {
    // Losing the entry would silently change the shape of the outline.
    const pdf = new PdfDocument();
    const tree = buildOutlineTree([heading(1, "One")]);
    const rootRef = writeOutline(pdf, tree, { destinationFor: () => undefined }) as PdfRef;

    const one = objectAt(pdf, objectAt(pdf, rootRef).get("First") as PdfRef);
    expect(one.has("Dest")).toBe(false);
    expect(titleOf(one)).toBe("One");
  });
});

/** The text of an outline entry's title. */
function titleOf(entry: PdfDict): string {
  const title = entry.get("Title");
  if (!(title instanceof PdfLiteralString)) throw new Error("title is not a literal string");
  return String.fromCharCode(...title.bytes);
}

/** Read back an object the document has been given. */
function objectAt(pdf: PdfDocument, target: PdfRef): PdfDict {
  const found = pdf.objectFor(target);
  if (!(found instanceof PdfDict)) throw new Error(`object ${target.num} is not a dictionary`);
  return found;
}
