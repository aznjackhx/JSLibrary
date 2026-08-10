/**
 * Licence verification.
 *
 * Offline, with WebCrypto, against a public key compiled into the bundle. No
 * network request is made here or anywhere else — an enterprise will reject a
 * library that phones home, and there is no revocation list to consult because
 * there is no revocation.
 *
 * This is compliance hygiene, not DRM. Client-side JavaScript can always be
 * patched, and no effort is spent on obfuscation or anti-tamper. The real
 * enforcement is the licence itself: a company with a legal department cannot
 * ship AGPL code inside a proprietary product.
 */

import { BUILD_DATE } from "../build-info.js";
import { PUBLIC_KEY_BYTES } from "./public-key.js";
import { isCalendarDate, parseToken, type LicensePayload } from "./token.js";

/** Why a licence is not in force. */
export type LicenseFailure =
  | "absent"
  | "malformed"
  | "bad-signature"
  | "build-newer-than-updates"
  | "unsupported-platform";

export type LicenseStatus =
  | { readonly valid: true; readonly license: LicensePayload }
  | { readonly valid: false; readonly reason: LicenseFailure };

export interface VerifyOptions {
  /**
   * The release date of the build being run, as `YYYY-MM-DD`.
   *
   * Defaults to the date compiled into this bundle. Overridable for tests, and
   * for a host that wants to pin it explicitly.
   */
  readonly buildDate?: string;
  /** Raw Ed25519 public key. Defaults to the one shipped in the bundle. */
  readonly publicKey?: Uint8Array;
}

/**
 * Does a licence cover this build?
 *
 * ```
 * MUST be:      buildDate <= license.updatesUntil
 * MUST NOT be:  Date.now() <= license.updatesUntil
 * ```
 *
 * The first is a perpetual licence: whatever a customer shipped keeps working
 * forever, because the build's own date never changes. The key stops accepting
 * *newer releases* once maintenance lapses, which is the thing they stopped
 * paying for.
 *
 * The second would be a subscription that takes down every customer's
 * production app on renewal day. Both comparisons look almost identical in a
 * diff, which is exactly why this is its own named function with its own test.
 */
export function coversBuild(updatesUntil: string, buildDate: string): boolean {
  // Both are `YYYY-MM-DD`, so lexical order is chronological order.
  return buildDate <= updatesUntil;
}

/** Is Ed25519 verification available here? */
async function importKey(publicKey: Uint8Array): Promise<CryptoKey | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;

  try {
    return await subtle.importKey(
      "raw",
      publicKey as unknown as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    // Ed25519 is unevenly supported. An engine that lacks it cannot check the
    // licence, which is reported rather than treated as a forgery.
    return undefined;
  }
}

/**
 * Verify a licence token.
 *
 * Never throws and never makes a network request. Every failure is a value the
 * caller can act on, because the correct response to a bad licence is to run
 * unlicensed — not to break the page.
 */
export async function verifyLicense(
  token: string | undefined,
  options: VerifyOptions = {},
): Promise<LicenseStatus> {
  if (!token || token.trim() === "") return { valid: false, reason: "absent" };

  const parsed = parseToken(token);
  if (!parsed) return { valid: false, reason: "malformed" };

  const buildDate = options.buildDate ?? BUILD_DATE;
  if (!isCalendarDate(buildDate)) return { valid: false, reason: "malformed" };

  const key = await importKey(options.publicKey ?? PUBLIC_KEY_BYTES);
  if (!key) return { valid: false, reason: "unsupported-platform" };

  let signatureOk = false;
  try {
    signatureOk = await (globalThis.crypto.subtle as SubtleCrypto).verify(
      { name: "Ed25519" },
      key,
      parsed.signature as unknown as BufferSource,
      parsed.signedBytes as unknown as BufferSource,
    );
  } catch {
    return { valid: false, reason: "bad-signature" };
  }

  if (!signatureOk) return { valid: false, reason: "bad-signature" };

  // Checked after the signature: an unsigned token's dates mean nothing, so
  // there is no point reporting on them.
  if (!coversBuild(parsed.payload.updatesUntil, buildDate)) {
    return { valid: false, reason: "build-newer-than-updates" };
  }

  return { valid: true, license: parsed.payload };
}

/** Does a verified licence cover a given feature? */
export function licenseCovers(license: LicensePayload, feature: string): boolean {
  // No feature list means the whole product.
  return license.features === undefined || license.features.includes(feature);
}

/** A sentence explaining a failure, for the one warning that gets logged. */
export function explainFailure(reason: LicenseFailure): string {
  switch (reason) {
    case "absent":
      return "no licence key was supplied";
    case "malformed":
      return "the licence key could not be read";
    case "bad-signature":
      return "the licence key's signature did not verify";
    case "build-newer-than-updates":
      return "this build is newer than the licence's updatesUntil date (the licence still covers any build released on or before that date)";
    case "unsupported-platform":
      return "this environment does not support Ed25519 verification";
  }
}
