import { describe, expect, it } from "vitest";

import { parsePageRulesFromText } from "../src/page/atrules.js";
import { cascadeFor, pageContextFor, parseMargins, parseSize, ruleApplies } from "../src/page/context.js";

const defaults = { size: "A4" as const, orientation: "portrait" as const, margins: "0.5in" };
const context = (css: string, pageIndex: number, overrides = {}) =>
  pageContextFor({
    rules: parsePageRulesFromText(css),
    pageIndex,
    overrides,
    defaults,
  });

describe("ruleApplies", () => {
  const rule = (pseudos: string[]) => ({
    pseudos,
    declarations: new Map(),
    marginBoxes: new Map(),
    order: 0,
  });

  it("applies a bare rule to every page", () => {
    for (const index of [0, 1, 2, 7]) expect(ruleApplies(rule([]), index)).toBe(true);
  });

  it("applies :first only to the first page", () => {
    expect(ruleApplies(rule(["first"]), 0)).toBe(true);
    expect(ruleApplies(rule(["first"]), 1)).toBe(false);
  });

  it("treats page one as a right-hand page", () => {
    expect(ruleApplies(rule(["right"]), 0)).toBe(true);
    expect(ruleApplies(rule(["left"]), 0)).toBe(false);
    expect(ruleApplies(rule(["left"]), 1)).toBe(true);
    expect(ruleApplies(rule(["right"]), 2)).toBe(true);
  });

  it("ignores a named page, which needs an element to opt in", () => {
    expect(ruleApplies(rule(["cover"]), 0)).toBe(false);
  });
});

describe("cascadeFor", () => {
  const css = `
    @page { margin: 1cm; size: A4 }
    @page :left { margin-left: 3cm }
    @page :first { margin-top: 5cm }
  `;

  it("lets a more specific rule win", () => {
    const { declarations } = cascadeFor(parsePageRulesFromText(css), 0);
    expect(declarations.get("margin-top")).toBe("5cm");
    expect(declarations.get("margin")).toBe("1cm");
  });

  it("applies :left only on left pages", () => {
    expect(cascadeFor(parsePageRulesFromText(css), 1).declarations.get("margin-left")).toBe("3cm");
    expect(cascadeFor(parsePageRulesFromText(css), 2).declarations.has("margin-left")).toBe(false);
  });

  it("breaks ties by source order", () => {
    const rules = parsePageRulesFromText("@page { margin: 1cm } @page { margin: 2cm }");
    expect(cascadeFor(rules, 0).declarations.get("margin")).toBe("2cm");
  });

  it("merges margin boxes across rules", () => {
    const rules = parsePageRulesFromText(
      "@page { @top-center { content: 'a'; color: red } } @page :first { @top-center { content: 'b' } }",
    );
    const box = cascadeFor(rules, 0).marginBoxes.get("top-center");

    expect(box?.get("content")).toBe("'b'");
    // The weaker rule's other declarations survive.
    expect(box?.get("color")).toBe("red");
  });
});

describe("parseSize", () => {
  it("reads a keyword", () => {
    expect(parseSize("A4")).toEqual({ size: "a4" });
  });

  it("reads a keyword with an orientation", () => {
    expect(parseSize("A4 landscape")).toEqual({ size: "a4", orientation: "landscape" });
  });

  it("reads two lengths", () => {
    expect(parseSize("8.5in 11in")).toEqual({ size: { width: "8.5in", height: "11in" } });
  });

  it("treats one length as a square page", () => {
    expect(parseSize("10cm")).toEqual({ size: { width: "10cm", height: "10cm" } });
  });

  it("leaves the caller's choice alone for auto", () => {
    expect(parseSize("auto")).toBeUndefined();
    expect(parseSize("  ")).toBeUndefined();
  });
});

describe("parseMargins", () => {
  it("expands the shorthand like CSS", () => {
    expect(parseMargins(new Map([["margin", "1cm"]]), "0")).toEqual({
      top: "1cm", right: "1cm", bottom: "1cm", left: "1cm",
    });
    expect(parseMargins(new Map([["margin", "1cm 2cm"]]), "0")).toEqual({
      top: "1cm", right: "2cm", bottom: "1cm", left: "2cm",
    });
    expect(parseMargins(new Map([["margin", "1cm 2cm 3cm"]]), "0")).toEqual({
      top: "1cm", right: "2cm", bottom: "3cm", left: "2cm",
    });
  });

  it("lets a longhand override the shorthand", () => {
    const result = parseMargins(
      new Map([["margin", "1cm"], ["margin-top", "4cm"]]),
      "0",
    );
    expect(result).toEqual({
      top: "113.38582677165354pt", right: "28.346456692913385pt",
      bottom: "28.346456692913385pt", left: "28.346456692913385pt",
    });
  });

  it("falls back when nothing is declared", () => {
    expect(parseMargins(new Map(), "0.5in")).toBe("0.5in");
  });
});

describe("pageContextFor", () => {
  it("honours the stylesheet when the caller asks for nothing", () => {
    const result = context("@page { size: Letter; margin: 1in }", 0);
    expect(result.size).toEqual({ width: 612, height: 792 });
    expect(result.margins).toEqual({ top: 72, right: 72, bottom: 72, left: 72 });
  });

  it("lets the caller override the stylesheet", () => {
    const result = context("@page { size: Letter; margin: 1in }", 0, {
      size: "A4",
      margins: "0.25in",
    });
    expect(result.size.width).toBeCloseTo(595.276, 2);
    expect(result.margins.top).toBe(18);
  });

  it("falls back to the defaults when neither specifies", () => {
    const result = context("", 0);
    expect(result.size.width).toBeCloseTo(595.276, 2);
    expect(result.margins.top).toBe(36);
  });

  it("gives different pages different geometry", () => {
    const css = "@page { margin: 1cm } @page :first { margin: 3cm }";
    expect(context(css, 0).margins.top).toBeCloseTo(85.04, 1);
    expect(context(css, 1).margins.top).toBeCloseTo(28.35, 1);
  });

  it("computes the content box", () => {
    const result = context("@page { size: Letter; margin: 1in }", 0);
    expect(result.content).toEqual({ x: 72, y: 72, width: 468, height: 648 });
  });

  it("refuses margins that leave no content area", () => {
    expect(() => context("@page { size: A5; margin: 6in }", 0)).toThrow(RangeError);
  });
});
