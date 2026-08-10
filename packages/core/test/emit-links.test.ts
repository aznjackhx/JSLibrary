import { describe, expect, it } from "vitest";

import {
  collectAnchors,
  collectLinks,
  fragmentId,
  isFragment,
  linkAnnotations,
} from "../src/emit/links.js";
import type { MeasuredElement, MeasuredNode, MeasuredRect } from "../src/measure/types.js";
import { PageTransform } from "../src/emit/transform.js";
import type { PdfDict } from "../src/pdf/objects.js";

const style = {
  display: "block",
  position: "static",
  float: "none",
  fontFamily: "serif",
  fontSize: 16,
  fontWeight: 400,
  fontStyle: "normal",
  lineHeight: 20,
  letterSpacing: 0,
  wordSpacing: 0,
  textAlign: "start",
  textDecorationLine: "none",
  whiteSpace: "normal",
  color: { r: 0, g: 0, b: 0, a: 1 },
  backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
  opacity: 1,
  borderTop: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
  borderRight: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
  borderBottom: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
  borderLeft: { width: 0, style: "none", color: { r: 0, g: 0, b: 0, a: 0 } },
  borderRadius: [0, 0, 0, 0] as const,
  padding: [0, 0, 0, 0] as const,
  margin: [0, 0, 0, 0] as const,
  overflow: "visible",
  boxDecorationBreak: "slice",
  visibility: "visible",
  transform: "none",
  zIndex: "auto",
  breakBefore: "auto",
  breakAfter: "auto",
  breakInside: "auto",
  orphans: 2,
  widows: 2,
};

const rect = (y: number, height = 20, x = 0, width = 100): MeasuredRect => ({
  x,
  y,
  width,
  height,
});

function element(
  tag: string,
  at: MeasuredRect,
  children: MeasuredNode[] = [],
  extra: Partial<MeasuredElement> = {},
): MeasuredElement {
  return {
    kind: "element",
    tag,
    id: undefined,
    classes: [],
    rect: at,
    contentRect: at,
    style,
    src: undefined,
    imageRef: undefined,
    svg: undefined,
    href: undefined,
    hrefResolved: undefined,
    children,
    ...extra,
  };
}

function text(lines: MeasuredRect[]): MeasuredNode {
  return {
    kind: "text",
    text: "link text",
    lines: lines.map((line) => ({ text: "link text", rect: line, baseline: line.y + 15 })),
  };
}

describe("collectLinks", () => {
  it("gives a wrapped link one rect per line", () => {
    // The whole point: a link across two lines is two clickable rectangles,
    // not one box swallowing the paragraph between them.
    const link = element("a", rect(0, 40), [text([rect(0), rect(20)])], {
      href: "https://example.com/",
      hrefResolved: "https://example.com/",
    });

    const [found] = collectLinks(element("div", rect(0, 40), [link]));

    expect(found?.rects).toHaveLength(2);
    expect(found?.rects.map((r) => r.y)).toEqual([0, 20]);
  });

  it("falls back to the element box when a link has no text", () => {
    // An <a> wrapping an image: no line boxes, still clickable.
    const link = element("a", rect(0, 60), [element("img", rect(0, 60))], {
      href: "https://example.com/",
      hrefResolved: "https://example.com/",
    });

    const [found] = collectLinks(element("div", rect(0, 60), [link]));

    expect(found?.rects).toEqual([rect(0, 60)]);
  });

  it("ignores an element with no href", () => {
    expect(collectLinks(element("div", rect(0), [element("span", rect(0))]))).toEqual([]);
  });

  it("keeps the authored href alongside the resolved one", () => {
    const link = element("a", rect(0), [text([rect(0)])], {
      href: "#section",
      hrefResolved: "https://example.com/page#section",
    });

    const [found] = collectLinks(element("div", rect(0), [link]));

    expect(found?.href).toBe("#section");
    expect(found?.resolved).toBe("https://example.com/page#section");
  });
});

describe("collectAnchors", () => {
  it("finds every element with an id, in document order", () => {
    const root = element("div", rect(0, 100), [
      element("h2", rect(10), [], { id: "one" }),
      element("section", rect(40), [element("p", rect(60), [], { id: "three" })], {
        id: "two",
      }),
    ]);

    expect(collectAnchors(root).map((anchor) => anchor.id)).toEqual(["one", "two", "three"]);
  });
});

describe("fragments", () => {
  it("recognises an in-document href", () => {
    expect(isFragment("#section")).toBe(true);
    expect(isFragment("https://example.com/#section")).toBe(false);
    // A bare hash is a placeholder, not a target.
    expect(isFragment("#")).toBe(false);
  });

  it("decodes a percent-escaped id", () => {
    expect(fragmentId("#a%20b")).toBe("a b");
  });

  it("keeps a malformed escape literal rather than throwing", () => {
    expect(fragmentId("#100%")).toBe("100%");
  });
});

describe("linkAnnotations", () => {
  const transform = new PageTransform({
    content: { x: 0, y: 0, width: 500, height: 500 },
  });

  const external = {
    href: "https://example.com/",
    resolved: "https://example.com/",
    rects: [rect(0)],
  };

  const get = (annotation: PdfDict, key: string): unknown => annotation.get(key);

  it("builds a URI action for an external link", () => {
    const [annotation] = linkAnnotations([external], {
      transform,
      band: { top: 0, bottom: 500 },
      resolveFragment: () => undefined,
    });

    expect(String(get(annotation as PdfDict, "Subtype"))).toBe("/Link");
    expect(String(get(get(annotation as PdfDict, "A") as PdfDict, "S"))).toBe("/URI");
  });

  it("draws no border, which a viewer would otherwise add", () => {
    const [annotation] = linkAnnotations([external], {
      transform,
      band: { top: 0, bottom: 500 },
      resolveFragment: () => undefined,
    });

    expect(get(annotation as PdfDict, "Border")).toEqual([0, 0, 0]);
  });

  it("omits an in-document link whose target was never measured", () => {
    // A link that silently goes nowhere is worse than no link: a reader cannot
    // tell it is broken until they click it.
    const annotations = linkAnnotations(
      [{ href: "#missing", resolved: "#missing", rects: [rect(0)] }],
      { transform, band: { top: 0, bottom: 500 }, resolveFragment: () => undefined },
    );

    expect(annotations).toEqual([]);
  });

  it("builds a GoTo action when the target is known", () => {
    const [annotation] = linkAnnotations(
      [{ href: "#there", resolved: "#there", rects: [rect(0)] }],
      {
        transform,
        band: { top: 0, bottom: 500 },
        resolveFragment: (id) => (id === "there" ? [1, 2, 3] : undefined),
      },
    );

    expect(String(get(get(annotation as PdfDict, "A") as PdfDict, "S"))).toBe("/GoTo");
  });

  it("drops rects that belong to another page", () => {
    const annotations = linkAnnotations([{ ...external, rects: [rect(600)] }], {
      transform,
      band: { top: 0, bottom: 500 },
      resolveFragment: () => undefined,
    });

    expect(annotations).toEqual([]);
  });

  it("clips a link that straddles a page boundary", () => {
    // Both halves stay clickable, each on its own page.
    const straddling = { ...external, rects: [rect(490, 20)] };

    const first = linkAnnotations([straddling], {
      transform,
      band: { top: 0, bottom: 500 },
      resolveFragment: () => undefined,
    });
    const second = linkAnnotations([straddling], {
      transform,
      band: { top: 500, bottom: 1000 },
      resolveFragment: () => undefined,
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });
});
