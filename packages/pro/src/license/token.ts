/**
 * The licence token format.
 *
 * A token is two base64url parts joined by a dot:
 *
 *     <payload>.<signature>
 *
 * The signature covers the **encoded payload string**, byte for byte — not a
 * re-serialised object. That distinction is the whole reason the format is
 * shaped this way: if verification re-encoded the JSON first, a difference in
 * key order or number formatting between the signer and the verifier would
 * break every key in the field, and it would break them silently and only for
 * some customers. Signing the exact bytes removes the question.
 */

/** What a licence asserts. */
export interface LicensePayload {
  /** Who the licence is issued to, as it should appear in an audit. */
  readonly licensee: string;
  /** Seats purchased. Not enforced at runtime — this is compliance, not DRM. */
  readonly seats: number;
  /**
   * The last release date this key accepts, as `YYYY-MM-DD`.
   *
   * Compared against the *build* date, never against the current time. See
   * `verify.ts`; getting that backwards turns a perpetual licence into a
   * subscription that expires in production.
   */
  readonly updatesUntil: string;
  readonly edition: string;
  /** Feature slugs this licence unlocks. Absent means every feature. */
  readonly features?: readonly string[];
}

/** Encode bytes as base64url, without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Decode base64url, tolerating missing padding. */
export function fromBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return undefined;

  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A token split into the parts verification needs. */
export interface ParsedToken {
  /** The payload's encoded form — the bytes the signature covers. */
  readonly signedBytes: Uint8Array;
  readonly payload: LicensePayload;
  readonly signature: Uint8Array;
}

/**
 * Split and decode a token without checking its signature.
 *
 * Returns undefined for anything that is not two well-formed parts holding a
 * plausible payload. A malformed token is not an error to throw on: it arrives
 * from a customer's configuration, and the library's answer to a bad licence is
 * always to carry on unlicensed rather than to break their build.
 */
export function parseToken(token: string): ParsedToken | undefined {
  const trimmed = token.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return undefined;
  // Exactly two parts; a second dot means this is some other format.
  if (trimmed.indexOf(".", dot + 1) !== -1) return undefined;

  const encodedPayload = trimmed.slice(0, dot);
  const encodedSignature = trimmed.slice(dot + 1);

  const payloadBytes = fromBase64Url(encodedPayload);
  const signature = fromBase64Url(encodedSignature);
  if (!payloadBytes || !signature) return undefined;

  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return undefined;
  }

  if (!isPayload(payload)) return undefined;

  return {
    signedBytes: encoder.encode(encodedPayload),
    payload,
    signature,
  };
}

function isPayload(value: unknown): value is LicensePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate["licensee"] !== "string") return false;
  if (typeof candidate["seats"] !== "number") return false;
  if (typeof candidate["edition"] !== "string") return false;

  const until = candidate["updatesUntil"];
  if (typeof until !== "string" || !isCalendarDate(until)) return false;

  const features = candidate["features"];
  if (
    features !== undefined &&
    (!Array.isArray(features) || features.some((entry) => typeof entry !== "string"))
  ) {
    return false;
  }

  return true;
}

/**
 * A `YYYY-MM-DD` date that names a real day.
 *
 * The round-trip catches `2025-02-30`, which `Date.parse` silently rolls over
 * into March — a licence dated to a day that does not exist is a signing
 * mistake worth rejecting rather than quietly reinterpreting.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;

  return parsed.toISOString().slice(0, 10) === value;
}

/**
 * Build the signing input for a payload.
 *
 * Used by the signing tool, and by tests. The bytes returned here are exactly
 * what `parseToken` hands back as `signedBytes`.
 */
export function encodePayload(payload: LicensePayload): {
  encoded: string;
  signedBytes: Uint8Array;
} {
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  return { encoded, signedBytes: encoder.encode(encoded) };
}

/** Assemble a token from an encoded payload and its signature. */
export function formatToken(encodedPayload: string, signature: Uint8Array): string {
  return `${encodedPayload}.${toBase64Url(signature)}`;
}
