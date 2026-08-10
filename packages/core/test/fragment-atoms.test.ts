import { describe, expect, it } from "vitest";

import { buildFragmentModel } from "../src/fragment/atoms.js";
import type { CapturedStyle, MeasuredElement, MeasuredNode } from "../src/measure/types.js";

const style = (overrides: Partial<CapturedStyle> = {}): CapturedStyle =>
  ({
    position: "static",
    float: "none",
    breakBefore: "auto",
    breakAfter: "auto",
    breakInside: "auto",
    orphans: 2,
    widows: 2,
    ...overrides,
  }) as CapturedStyle;

const element = (
  tag: string,
  y: number,
  height: number,
  children: MeasuredNode[] = [],
  overrides: Partial<CapturedStyle> = {},
  extra: Partial<MeasuredElement> = {},
): MeasuredElement =>
  ({
    kind: "element",
    tag,
    id: undefined,
    classes: [],
    rect: { x: 0, y, width: 100, height },
    contentRect: { x: 0, y, width: 100, height },
    style: style(overrides),
    src: undefined,
    imageRef: undefined,
    href: undefined,
    children,
    ...extra,
  }) as MeasuredElement;

const text = (tops: number[], height = 20): MeasuredNode => ({
  kind: "text",
  text: "x",
  lines: tops.map((y) => ({
    text: "x",
    rect: { x: 0, y, width: 50, height },
    baseline: y + height * 0.8,
  })),
});

describe("buildFragmentModel", () => {
  it("makes each line an atom", () => {
    // Minimums of 1 leave every break position open, so the lines stay
    // separate; the default of 2 and 2 would merge a three-line block, which
    // is asserted below.
    const { atoms } = buildFragmentModel(element("div", 0, 60, [text([0, 20, 40])]), {
      orphans: 1,
      widows: 1,
    });

    expect(atoms).toHaveLength(3);
    expect(atoms.every((atom) => atom.kind === "line")).toBe(true);
    expect(atoms[0]).toEqual({ kind: "line", top: 0, bottom: 20 });
  });

  it("merges a block the default minimums make unbreakable", () => {
    // Three lines cannot satisfy orphans 2 and widows 2 on both sides of any
    // split, so the paragraph must move whole.
    const { atoms } = buildFragmentModel(element("div", 0, 60, [text([0, 20, 40])]));
    expect(atoms).toEqual([{ kind: "line", top: 0, bottom: 60 }]);
  });

  it("sorts atoms by position regardless of tree order", () => {
    const root = element("div", 0, 100, [
      element("p", 60, 20, [text([60])]),
      element("p", 0, 20, [text([0])]),
    ]);
    const { atoms } = buildFragmentModel(root, { orphans: 1, widows: 1 });
    expect(atoms.map((atom) => atom.top)).toEqual([0, 60]);
  });

  it("treats an image as one indivisible span", () => {
    const root = element("div", 0, 100, [
      element("img", 10, 80, [], {}, { imageRef: "image-1" }),
    ]);
    const { atoms } = buildFragmentModel(root);

    expect(atoms).toEqual([{ kind: "replaced", top: 10, bottom: 90 }]);
  });

  it("treats break-inside: avoid as one indivisible span", () => {
    const root = element("div", 0, 100, [
      element("section", 10, 80, [text([10, 30, 50])], { breakInside: "avoid" }),
    ]);
    const { atoms } = buildFragmentModel(root);

    // The block's own span replaces its lines: a break forbidden inside the
    // block is already forbidden between its lines.
    expect(atoms).toEqual([{ kind: "avoid", top: 10, bottom: 90 }]);
  });

  it("does not nest atoms inside atoms", () => {
    const root = element("div", 0, 200, [
      element(
        "section",
        0,
        200,
        [element("img", 10, 50, [], {}, { imageRef: "image-1" }), text([70, 90])],
        { breakInside: "avoid" },
      ),
    ]);
    const { atoms } = buildFragmentModel(root);
    expect(atoms).toHaveLength(1);
  });

  it("collects forced breaks before and after", () => {
    const root = element("div", 0, 200, [
      element("section", 50, 60, [], { breakBefore: "page" }),
      element("section", 120, 40, [], { breakAfter: "always" }),
    ]);
    const { forced } = buildFragmentModel(root);

    expect(forced.map((entry) => entry.y)).toEqual([50, 160]);
  });

  it("recognises every forcing keyword", () => {
    for (const keyword of ["page", "always", "left", "right", "recto", "verso"]) {
      const root = element("div", 0, 100, [element("p", 40, 10, [], { breakBefore: keyword })]);
      expect(buildFragmentModel(root).forced, keyword).toHaveLength(1);
    }
  });

  it("records which side each keyword demands", () => {
    const parityOf = (keyword: string): string => {
      const root = element("div", 0, 100, [element("p", 40, 10, [], { breakBefore: keyword })]);
      return buildFragmentModel(root).forced[0]?.parity as string;
    };

    expect(parityOf("page")).toBe("any");
    expect(parityOf("always")).toBe("any");
    expect(parityOf("left")).toBe("left");
    expect(parityOf("verso")).toBe("left");
    expect(parityOf("right")).toBe("right");
    expect(parityOf("recto")).toBe("right");
  });

  it("keeps the stronger demand when two breaks coincide", () => {
    // `break-after: page` on one element and `break-before: right` on the next
    // are one break position with two demands; the side-specific one governs.
    const root = element("div", 0, 200, [
      element("section", 0, 50, [], { breakAfter: "page" }),
      element("section", 50, 60, [], { breakBefore: "right" }),
    ]);
    const { forced } = buildFragmentModel(root);

    expect(forced).toHaveLength(1);
    expect(forced[0]?.parity).toBe("right");
  });

  it("ignores break values that do not force a page", () => {
    for (const keyword of ["auto", "avoid", "column", "avoid-page"]) {
      const root = element("div", 0, 100, [element("p", 40, 10, [], { breakBefore: keyword })]);
      expect(buildFragmentModel(root).forced, keyword).toEqual([]);
    }
  });

  it("ignores zero-height elements", () => {
    const root = element("div", 0, 100, [
      element("img", 10, 0, [], {}, { imageRef: "image-1" }),
    ]);
    expect(buildFragmentModel(root).atoms).toEqual([]);
  });
});

describe("out-of-flow content", () => {
  it("keeps a floated box whole", () => {
    const root = element("div", 0, 200, [
      element("aside", 10, 80, [text([10, 30, 50])], { float: "right" }),
    ]);
    expect(buildFragmentModel(root).atoms).toEqual([
      { kind: "out-of-flow", top: 10, bottom: 90 },
    ]);
  });

  it("keeps an absolutely positioned box whole", () => {
    const root = element("div", 0, 200, [
      element("aside", 10, 80, [text([10, 30])], { position: "absolute" }),
    ]);
    expect(buildFragmentModel(root).atoms).toEqual([
      { kind: "out-of-flow", top: 10, bottom: 90 },
    ]);
  });

  it("treats sticky as the static box it degrades to without a viewport", () => {
    const root = element("div", 0, 100, [
      element("p", 0, 60, [text([0, 20, 40])], { position: "sticky" }),
    ]);
    // Ordinary line atoms, merged by the default orphan and widow minimums.
    expect(buildFragmentModel(root).atoms).toEqual([{ kind: "line", top: 0, bottom: 60 }]);
  });

  it("does not reclassify in-flow content when float is absent", () => {
    // A missing value must not be read as "floated" — the whole document would
    // become one unbreakable span.
    const root = element("div", 0, 100, [element("p", 0, 60, [text([0, 20, 40])])]);
    const { atoms } = buildFragmentModel(root, { orphans: 1, widows: 1 });
    expect(atoms.every((atom) => atom.kind === "line")).toBe(true);
  });
});
