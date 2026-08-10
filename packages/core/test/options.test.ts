import { describe, expect, it } from "vitest";

import { resolveOptions } from "../src/options.js";

describe("resolveOptions", () => {
  it("fills in defaults", () => {
    const resolved = resolveOptions();
    expect(resolved.textMode).toBe("precise");
    expect(resolved.page.size.width).toBeCloseTo(595.2756, 3);
    expect(resolved.metadata.keywords).toEqual([]);
    expect(resolved.metadata.creationDate).toBeInstanceOf(Date);
  });

  it("keeps precise as the default text mode but allows fast", () => {
    expect(resolveOptions({ textMode: "fast" }).textMode).toBe("fast");
  });

  it("honours a pinned creation date so output can be byte-identical", () => {
    const creationDate = new Date("2020-01-01T00:00:00Z");
    expect(resolveOptions({ metadata: { creationDate } }).metadata.creationDate).toBe(
      creationDate,
    );
  });

  it("surfaces geometry errors at option-resolution time", () => {
    expect(() => resolveOptions({ pageSize: "A4", margins: "20in" })).toThrow(RangeError);
  });
});
