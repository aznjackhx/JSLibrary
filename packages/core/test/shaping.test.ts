import { describe, expect, it } from "vitest";

import { scriptsNeedingShaping, shapingWarning } from "../src/fonts/shaping.js";

describe("scriptsNeedingShaping", () => {
  it("says nothing about scripts that render correctly", () => {
    // These need no GSUB to be legible. Warning about them would train the
    // reader to ignore the warning.
    expect(scriptsNeedingShaping("Hello — Ünïcödé ✓")).toEqual([]);
    expect(scriptsNeedingShaping("Ελληνικά Кириллица")).toEqual([]);
    expect(scriptsNeedingShaping("四半期業績報告書 東京")).toEqual([]);
    expect(scriptsNeedingShaping("דוח רבעוני")).toEqual([]);
  });

  it("names Arabic, which renders as disconnected letters", () => {
    expect(scriptsNeedingShaping("التقرير الربعي")).toEqual(["Arabic"]);
  });

  it("names each affected script once, in the order first seen", () => {
    expect(scriptsNeedingShaping("a التقرير b नमस्ते c التقرير")).toEqual([
      "Arabic",
      "Devanagari",
    ]);
  });

  it("notices a single character in an otherwise Latin document", () => {
    // The case that matters most: one word in a long report, where nobody is
    // looking at that page.
    expect(scriptsNeedingShaping("Quarterly report — سلام — page 4")).toEqual(["Arabic"]);
  });
});

describe("shapingWarning", () => {
  it("says nothing when there is nothing to say", () => {
    expect(shapingWarning([])).toBeUndefined();
  });

  it("names the script, the symptom and what to do", () => {
    const warning = shapingWarning(["Arabic"]) as string;

    expect(warning).toContain("Arabic");
    expect(warning).toContain("isolated");
    // It must be clear the PDF still exists, or a caller will think it failed.
    expect(warning).toContain("still produced");
    expect(warning).toContain("Check the output");
  });
});
