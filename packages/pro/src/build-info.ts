/**
 * Facts about this build, stamped in at bundle time.
 *
 * `BUILD_DATE` is the release date of the artefact, and it is the *only* date
 * the licence check consults. tsup replaces the identifier below at build time.
 *
 * It is deliberately never `Date.now()`: a build's date has to be fixed at the
 * moment it is produced and never move again. If it drifted, a perpetual
 * licence would stop covering a build it had already accepted.
 */

declare const __BUILD_DATE__: string | undefined;

/**
 * Release date of this build, `YYYY-MM-DD`.
 *
 * Falls back to the epoch when nothing was stamped in — running from source, or
 * under test. That is the permissive direction on purpose: an unstamped build
 * is older than every licence, so a developer working from a checkout is never
 * blocked by a licence check that was never meant to gate them.
 */
export const BUILD_DATE: string =
  typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "1970-01-01";
