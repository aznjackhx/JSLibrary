import { describe, expect, it } from "vitest";

import { describeFace, FontError, RenderError } from "../src/errors.js";

describe("FontError", () => {
  it("names the face and keeps the original reason", () => {
    // The failure underneath is precise about the bytes and silent about
    // which font produced them. A document may pass a dozen faces, so the
    // face has to be in the message or the reader has to guess.
    const cause = new Error("Font has no usable Unicode cmap subtable");
    const error = new FontError(describeFace("Brand Sans", 700, "italic"), cause);

    expect(error.message).toContain('"Brand Sans" 700 italic');
    expect(error.message).toContain("no usable Unicode cmap subtable");
    expect(error.message).toContain("options.fonts");
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(RenderError);
  });

  it("leaves a regular face undecorated", () => {
    expect(describeFace("Brand Sans", 400, "normal")).toBe('"Brand Sans" 400');
  });
});
