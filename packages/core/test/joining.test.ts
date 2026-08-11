import { describe, expect, it } from "vitest";

import { joiningForms, joiningType } from "../src/fonts/joining.js";

const formsOf = (text: string): string[] => joiningForms([...text]);

describe("joiningType", () => {
  it("classifies the letters that decide where words break", () => {
    expect(joiningType("ب")).toBe("dual"); // beh joins both ways
    expect(joiningType("ا")).toBe("right"); // alef ends a joined run
    expect(joiningType("د")).toBe("right"); // dal, likewise
    expect(joiningType("ـ")).toBe("causing"); // tatweel
    expect(joiningType("َ")).toBe("transparent"); // fatha, a mark
    expect(joiningType("A")).toBe("none");
    expect(joiningType(" ")).toBe("none");
  });
});

describe("joiningForms", () => {
  it("leaves a lone letter isolated", () => {
    expect(formsOf("ب")).toEqual(["isol"]);
  });

  it("joins a run of dual-joining letters", () => {
    // Three beh: initial, medial, final.
    expect(formsOf("ببب")).toEqual(["init", "medi", "fina"]);
  });

  it("breaks the run after a right-joining letter", () => {
    // beh + alef + beh: alef accepts a join from beh but gives none onward,
    // so the second beh starts a new run. This is why Arabic words are drawn
    // in several joined pieces rather than one.
    expect(formsOf("باب")).toEqual(["init", "fina", "isol"]);
  });

  it("does not join across a space", () => {
    expect(formsOf("ب ب")).toEqual(["isol", "isol", "isol"]);
  });

  it("ignores a mark when deciding the letters around it", () => {
    // beh + fatha + beh: the mark must not break the join beneath it.
    const forms = formsOf("بَب");
    expect(forms[0]).toBe("init");
    expect(forms[2]).toBe("fina");
  });

  it("honours the zero-width non-joiner", () => {
    // Authors use it precisely to stop a join that would otherwise happen.
    expect(formsOf("ب‌ب")).toEqual(["isol", "isol", "isol"]);
  });

  it("joins through a zero-width joiner", () => {
    // The joiner is never drawn, so whatever form it is assigned does not
    // matter. What matters is that the letter before it joins forward, which
    // is the entire reason someone types one.
    expect(formsOf("ب‍")[0]).toBe("init");
  });

  it("leaves Latin alone", () => {
    expect(formsOf("abc")).toEqual(["isol", "isol", "isol"]);
  });
});
