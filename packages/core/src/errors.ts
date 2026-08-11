/** Base class for every error this library throws, so callers can catch one type. */
export class RenderError extends Error {
  override readonly name: string = "RenderError";
}

/** A pipeline stage that has not landed yet. Removed as milestones complete. */
export class NotImplementedError extends RenderError {
  override readonly name = "NotImplementedError";

  constructor(what: string) {
    super(`${what} is not implemented yet.`);
  }
}

/**
 * A font the caller supplied that could not be used.
 *
 * The failures underneath are precise about the byte that offended and say
 * nothing about which of the caller's fonts produced it. A document may pass
 * a dozen faces, so "Unsupported cmap subtable format 14" sends someone
 * looking through all of them. This names the face, keeps the original
 * message, and says what to do about it.
 */
export class FontError extends RenderError {
  override readonly name = "FontError";

  /**
   * @param face How to identify the font to the caller — the family they
   *   named where that is known, otherwise the name inside the file. Never
   *   invented: a face described with a weight this code did not actually
   *   have sends someone looking at the wrong file.
   */
  constructor(
    readonly face: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);

    super(
      `Could not use the font ${face}: ${detail}. ` +
        `Check the bytes passed for it in options.fonts are a complete, ` +
        `uncompressed TrueType or OpenType file — a WOFF2 file, an HTML error page ` +
        `fetched instead of the font, or a truncated response all fail here.`,
      { cause },
    );
  }
}

/** Describe a face the way the caller declared it. */
export function describeFace(family: string, weight: number, style: string): string {
  return `"${family}" ${weight}${style === "normal" ? "" : ` ${style}`}`;
}
