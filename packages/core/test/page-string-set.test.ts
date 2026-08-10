import { describe, expect, it } from "vitest";

import {
  parseStringSetRules,
  stringsForPage,
  type StringAssignment,
} from "../src/page/string-set.js";

describe("parseStringSetRules", () => {
  it("reads a rule", () => {
    const rules = parseStringSetRules("h2 { string-set: chapter content(); }");
    expect(rules).toEqual([
      { selector: "h2", name: "chapter", value: "content()", order: 0 },
    ]);
  });

  it("splits a selector list", () => {
    const rules = parseStringSetRules("h2, h3 { string-set: chapter content() }");
    expect(rules.map((rule) => rule.selector)).toEqual(["h2", "h3"]);
  });

  it("reads several assignments in one declaration", () => {
    const rules = parseStringSetRules(
      "h2 { string-set: chapter content(), section 'fixed' }",
    );
    expect(rules.map((rule) => rule.name)).toEqual(["chapter", "section"]);
    expect(rules[1]?.value).toBe("'fixed'");
  });

  it("does not split a selector on a comma inside :is()", () => {
    const rules = parseStringSetRules(":is(h2, h3) span { string-set: x content() }");
    expect(rules.map((rule) => rule.selector)).toEqual([":is(h2, h3) span"]);
  });

  it("ignores rules without string-set", () => {
    expect(parseStringSetRules("h2 { color: red }")).toEqual([]);
  });

  it("skips at-rules and their blocks", () => {
    // A string-set inside a media query needs media evaluation this does not do.
    const rules = parseStringSetRules(
      "@media print { h2 { string-set: chapter content() } } h3 { string-set: s content() }",
    );
    expect(rules.map((rule) => rule.selector)).toEqual(["h3"]);
  });

  it("keeps rules in source order", () => {
    const rules = parseStringSetRules(
      "h2 { string-set: a content() } h3 { string-set: b content() }",
    );
    expect(rules.map((rule) => rule.order)).toEqual([0, 1]);
  });

  it("survives an unterminated block", () => {
    expect(() => parseStringSetRules("h2 { string-set: a content()")).not.toThrow();
  });

  it("does not match string-set as a substring of another property", () => {
    expect(parseStringSetRules("h2 { -x-string-set: a content() }")).toEqual([]);
  });
});

describe("stringsForPage", () => {
  const assignments: StringAssignment[] = [
    { name: "chapter", value: "One", y: 0 },
    { name: "chapter", value: "Two", y: 500 },
    { name: "chapter", value: "Three", y: 900 },
  ];

  it("carries the entering value onto a page with no assignment", () => {
    // The whole point of a running header: page two of chapter one still says
    // "One" even though the heading was on page one.
    expect(stringsForPage(assignments, 100, 400).get("chapter")).toBe("One");
  });

  it("takes the first assignment on the page by default", () => {
    expect(stringsForPage(assignments, 400, 1000).get("chapter")).toBe("Two");
  });

  it("start ignores assignments on the page itself", () => {
    expect(stringsForPage(assignments, 400, 1000, "start").get("chapter")).toBe("One");
  });

  it("last takes the final assignment on the page", () => {
    expect(stringsForPage(assignments, 400, 1000, "last").get("chapter")).toBe("Three");
  });

  it("has nothing before the first assignment", () => {
    expect(stringsForPage(assignments, 0, 0).size).toBe(0);
  });

  it("tracks several names independently", () => {
    const mixed: StringAssignment[] = [
      { name: "chapter", value: "One", y: 0 },
      { name: "author", value: "Ada", y: 10 },
      { name: "chapter", value: "Two", y: 500 },
    ];
    const strings = stringsForPage(mixed, 400, 1000);

    expect(strings.get("chapter")).toBe("Two");
    expect(strings.get("author")).toBe("Ada");
  });
});
