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
