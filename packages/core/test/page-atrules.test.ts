import { describe, expect, it } from "vitest";

import { parsePageBody, parsePageRulesFromText } from "../src/page/atrules.js";

describe("parsePageRulesFromText", () => {
  it("reads a bare rule's declarations", () => {
    const [rule] = parsePageRulesFromText("@page { size: A4; margin: 2cm; }");

    expect(rule?.pseudos).toEqual([]);
    expect(rule?.declarations.get("size")).toBe("A4");
    expect(rule?.declarations.get("margin")).toBe("2cm");
  });

  it("reads pseudo-class selectors", () => {
    const rules = parsePageRulesFromText(
      "@page :first { margin-top: 4cm; } @page :left { margin-left: 3cm; }",
    );

    expect(rules).toHaveLength(2);
    expect(rules[0]?.pseudos).toEqual(["first"]);
    expect(rules[1]?.pseudos).toEqual(["left"]);
  });

  it("keeps rules in source order", () => {
    const rules = parsePageRulesFromText("@page { margin: 1cm } @page { margin: 2cm }");
    expect(rules.map((rule) => rule.order)).toEqual([0, 1]);
  });

  it("ignores everything that is not an @page rule", () => {
    const rules = parsePageRulesFromText("body { margin: 0 } @page { margin: 1cm } p { color: red }");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.declarations.get("margin")).toBe("1cm");
  });

  it("survives an unterminated rule rather than throwing", () => {
    expect(parsePageRulesFromText("@page { margin: 1cm")).toEqual([]);
  });

  it("handles an empty rule", () => {
    const [rule] = parsePageRulesFromText("@page {}");
    expect(rule?.declarations.size).toBe(0);
  });
});

describe("parsePageBody", () => {
  it("separates margin boxes from page declarations", () => {
    const { declarations, marginBoxes } = parsePageBody(
      "size: A4; @top-center { content: 'Report'; } margin: 2cm;",
    );

    expect(declarations.get("size")).toBe("A4");
    expect(declarations.get("margin")).toBe("2cm");
    expect(declarations.has("content")).toBe(false);
    expect(marginBoxes.get("top-center")?.get("content")).toBe("'Report'");
  });

  it("reads several margin boxes", () => {
    const { marginBoxes } = parsePageBody(
      "@top-left { content: 'L' } @bottom-right-corner { content: 'R' }",
    );

    expect([...marginBoxes.keys()].sort()).toEqual(["bottom-right-corner", "top-left"]);
  });

  it("ignores an unrecognised at-rule and its block", () => {
    const { declarations, marginBoxes } = parsePageBody(
      "margin: 1cm; @nonsense { content: 'x' } size: A4;",
    );

    expect(marginBoxes.size).toBe(0);
    expect(declarations.get("margin")).toBe("1cm");
    expect(declarations.get("size")).toBe("A4");
  });

  it("does not split a value on a semicolon inside a string", () => {
    const { marginBoxes } = parsePageBody("@top-center { content: 'a; b'; color: red }");
    const box = marginBoxes.get("top-center");

    expect(box?.get("content")).toBe("'a; b'");
    expect(box?.get("color")).toBe("red");
  });

  it("does not split a value on a semicolon inside a function", () => {
    const { declarations } = parsePageBody("margin: 1cm; size: calc(10cm + 2cm);");
    expect(declarations.get("size")).toBe("calc(10cm + 2cm)");
  });

  it("lowercases property names but preserves value case", () => {
    const { declarations } = parsePageBody("SIZE: A4 Landscape");
    expect(declarations.get("size")).toBe("A4 Landscape");
  });

  it("tolerates a missing final semicolon", () => {
    const { declarations } = parsePageBody("margin: 1cm");
    expect(declarations.get("margin")).toBe("1cm");
  });
});
