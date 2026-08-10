import { describe, expect, it } from "vitest";

import {
  evaluateContent,
  parseContentValue,
  resolveContent,
} from "../src/page/content-value.js";

const facts = { page: 3, pages: 14 };

describe("parseContentValue", () => {
  it("reads a plain string", () => {
    expect(parseContentValue("'Report'")).toEqual([{ kind: "text", value: "Report" }]);
    expect(parseContentValue('"Report"')).toEqual([{ kind: "text", value: "Report" }]);
  });

  it("reads a concatenation", () => {
    expect(parseContentValue('"Page " counter(page) " of " counter(pages)')).toEqual([
      { kind: "text", value: "Page " },
      { kind: "counter", name: "page" },
      { kind: "text", value: " of " },
      { kind: "counter", name: "pages" },
    ]);
  });

  it("reads a named string", () => {
    expect(parseContentValue("string(chapter)")).toEqual([{ kind: "string", name: "chapter" }]);
  });

  it("ignores a counter's style argument", () => {
    expect(parseContentValue("counter(page, decimal)")).toEqual([
      { kind: "counter", name: "page" },
    ]);
  });

  it("treats none and normal as empty", () => {
    expect(parseContentValue("none")).toEqual([]);
    expect(parseContentValue("normal")).toEqual([]);
    expect(parseContentValue("  ")).toEqual([]);
  });

  it("records an unsupported function rather than dropping it", () => {
    // Silently producing an empty header would hide the gap.
    const tokens = parseContentValue("attr(title)");
    expect(tokens).toEqual([{ kind: "unsupported", source: "attr(title)" }]);
  });

  it("decodes escapes in strings", () => {
    expect(parseContentValue('"a\\"b"')).toEqual([{ kind: "text", value: 'a"b' }]);
    expect(parseContentValue('"\\2014"')).toEqual([{ kind: "text", value: "—" }]);
  });

  it("keeps whitespace inside strings but not between tokens", () => {
    expect(parseContentValue("'  x  '   'y'")).toEqual([
      { kind: "text", value: "  x  " },
      { kind: "text", value: "y" },
    ]);
  });

  it("terminates on an unclosed string", () => {
    expect(() => parseContentValue("'unterminated")).not.toThrow();
  });
});

describe("resolveContent", () => {
  it("substitutes the page number and total", () => {
    expect(evaluateContent('"Page " counter(page) " of " counter(pages)', facts)).toBe(
      "Page 3 of 14",
    );
  });

  it("resolves a named string", () => {
    const strings = new Map([["chapter", "Methods"]]);
    expect(evaluateContent("string(chapter)", { ...facts, strings })).toBe("Methods");
  });

  it("yields nothing for a named string that was never set", () => {
    expect(evaluateContent("string(missing)", facts)).toBe("");
  });

  it("contributes nothing for a counter it cannot compute", () => {
    // A document counter needs tracking that does not exist; a wrong number
    // would be worse than none.
    expect(evaluateContent('"n=" counter(figure)', facts)).toBe("n=");
  });

  it("drops unsupported tokens from the output", () => {
    expect(evaluateContent('"a" attr(x) "b"', facts)).toBe("ab");
  });

  it("resolves an empty token list to an empty string", () => {
    expect(resolveContent([], facts)).toBe("");
  });
});
