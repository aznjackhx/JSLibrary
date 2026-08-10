/**
 * The pure parts of measurement: colour and length parsing, cluster
 * segmentation. Everything that needs a layout engine is a browser test.
 */

import { describe, expect, it } from "vitest";

import { clusterSpans } from "../src/measure/lines.js";
import { isVisuallyEmpty, parseColor, parsePx, round, TRANSPARENT } from "../src/measure/styles.js";
import type { CapturedStyle } from "../src/measure/types.js";

describe("parsePx", () => {
  it("reads computed pixel lengths", () => {
    expect(parsePx("12px")).toBe(12);
    expect(parsePx("0px")).toBe(0);
    expect(parsePx("-3.5px")).toBe(-3.5);
    expect(parsePx("12.3456789px")).toBe(12.346);
  });

  it("falls back for keywords and empty values", () => {
    expect(parsePx("")).toBe(0);
    expect(parsePx("auto", 7)).toBe(7);
    expect(parsePx("normal", 5)).toBe(5);
  });
});

describe("parseColor", () => {
  it("parses rgb and rgba", () => {
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it("parses the space-separated form with a slash before alpha", () => {
    expect(parseColor("rgb(10 20 30 / 0.25)")).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
  });

  it("treats transparent as fully transparent black", () => {
    expect(parseColor("transparent")).toEqual(TRANSPARENT);
    expect(parseColor("")).toEqual(TRANSPARENT);
  });

  it("degrades unknown colour syntax to transparent rather than throwing", () => {
    // Newer engines can compute to color(display-p3 …); measurement must not
    // abort partway through a document because of one exotic value.
    expect(parseColor("color(display-p3 1 0 0)")).toEqual(TRANSPARENT);
    expect(parseColor("nonsense")).toEqual(TRANSPARENT);
  });

  it("rounds channels to integers", () => {
    expect(parseColor("rgb(1.6, 2.4, 3.5)")).toEqual({ r: 2, g: 2, b: 4, a: 1 });
  });
});

describe("round", () => {
  it("quantises to three decimals and normalises negative zero", () => {
    expect(round(1 / 3)).toBe(0.333);
    expect(Object.is(round(-0.0001), 0)).toBe(true);
  });
});

describe("clusterSpans", () => {
  it("splits ASCII into one span per character", () => {
    expect(clusterSpans("abc").map((span) => span.text)).toEqual(["a", "b", "c"]);
  });

  it("keeps a combining sequence as one cluster", () => {
    // "e" followed by U+0301 combining acute is one grapheme at one position.
    const spans = clusterSpans("éx");
    expect(spans.map((span) => span.text)).toEqual(["é", "x"]);
  });

  it("keeps surrogate pairs together", () => {
    expect(clusterSpans("a\u{1F600}").map((span) => span.text)).toEqual(["a", "\u{1F600}"]);
  });

  it("reports offsets that index back into the source string", () => {
    const text = "éx";
    for (const span of clusterSpans(text)) {
      expect(text.slice(span.start, span.end)).toBe(span.text);
    }
  });

  it("handles an empty string", () => {
    expect(clusterSpans("")).toEqual([]);
  });
});

describe("isVisuallyEmpty", () => {
  const base = {
    backgroundColor: TRANSPARENT,
    borderTop: { width: 0, style: "none", color: TRANSPARENT },
    borderRight: { width: 0, style: "none", color: TRANSPARENT },
    borderBottom: { width: 0, style: "none", color: TRANSPARENT },
    borderLeft: { width: 0, style: "none", color: TRANSPARENT },
  } as unknown as CapturedStyle;

  it("is true when nothing would paint", () => {
    expect(isVisuallyEmpty(base)).toBe(true);
  });

  it("is false with a visible background", () => {
    expect(
      isVisuallyEmpty({ ...base, backgroundColor: { r: 0, g: 0, b: 0, a: 1 } }),
    ).toBe(false);
  });

  it("is false with a visible border", () => {
    expect(
      isVisuallyEmpty({
        ...base,
        borderTop: { width: 1, style: "solid", color: { r: 0, g: 0, b: 0, a: 1 } },
      }),
    ).toBe(false);
  });

  it("ignores a border whose colour is transparent", () => {
    expect(
      isVisuallyEmpty({ ...base, borderTop: { width: 4, style: "solid", color: TRANSPARENT } }),
    ).toBe(true);
  });
});
