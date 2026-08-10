/**
 * @pkg/pro — commercial add-ons. Never published under an open licence.
 *
 * Everything here is a `RenderExtension`, which is the one seam `@pkg/core`
 * exposes. A conformance profile cannot be applied to finished bytes without a
 * full PDF parser, so it has to participate while the object graph is built.
 *
 * Unlicensed use warns once and watermarks the output. It never throws and
 * never corrupts: a build that stops working because a key lapsed is a worse
 * outcome for everyone than one that ships with a grey line on each page.
 */

import type { RenderExtension, RenderExtensionContext } from "@pkg/core";

import { explainFailure, verifyLicense, licenseCovers } from "./license/verify.js";
import type { LicenseStatus } from "./license/verify.js";
import type { LicensePayload } from "./license/token.js";
import { stampWatermark } from "./watermark.js";

export { BUILD_DATE } from "./build-info.js";
export { coversBuild, explainFailure, licenseCovers, verifyLicense } from "./license/verify.js";
export type { LicenseFailure, LicenseStatus, VerifyOptions } from "./license/verify.js";
export type { LicensePayload } from "./license/token.js";
export { WATERMARK_TEXT } from "./watermark.js";

export type Edition = "core" | "pro" | "enterprise";

/** Feature slugs, one per commercial capability in the brief. */
export const PRO_FEATURES = [
  "pdfa",
  "pdfua",
  "acroform",
  "signature",
  "encryption",
  "print-production",
  "merge",
  "streaming-writer",
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];

export interface ProOptions {
  /** The licence token. Omit it and output is watermarked. */
  readonly license?: string;
  /**
   * Which conformance profile to apply. `none` still exercises the licence
   * check, which is what a caller wanting only the warning would use.
   *
   * PDF/A-2b lands in the next step; only `none` is accepted for now.
   */
  readonly profile?: "none";
}

/** Warned-about statuses, so a page renders many documents without shouting. */
const warned = new Set<string>();

function warnOnce(reason: string, message: string): void {
  if (warned.has(reason)) return;
  warned.add(reason);
  // eslint-disable-next-line no-console -- the brief specifies a console.warn.
  console.warn(message);
}

/** Reset the warn-once state. Exported for tests. */
export function resetWarnings(): void {
  warned.clear();
}

/**
 * Build the extension that applies Pro features to a render.
 *
 * ```ts
 * const pdf = await render(element, {
 *   fonts,
 *   extensions: [await pro({ license: KEY, profile: "pdfa-2b" })],
 * });
 * ```
 *
 * The licence is verified once, here, rather than on every page: verification
 * is asynchronous and `RenderExtension` hooks are not, which is deliberate —
 * an extension that could await would be able to stall a render indefinitely.
 */
export async function pro(options: ProOptions = {}): Promise<RenderExtension> {
  const status = await verifyLicense(options.license);
  const licensed = status.valid && licenseCovers(status.license, "pdfa");

  if (!licensed) {
    warnOnce(
      status.valid ? "feature" : status.reason,
      `@pkg/pro is running unlicensed: ${
        status.valid
          ? "this licence does not cover the requested feature"
          : explainFailure(status.reason)
      }. Output will be watermarked. See COMMERCIAL-LICENSE.md.`,
    );
  }

  return {
    name: "@pkg/pro",
    finish(context: RenderExtensionContext): void {
      // Stamped last, so it marks whatever the render produced.
      if (!licensed) stampWatermark(context.document);
    },
  };
}

/** Verify a licence without rendering anything. */
export async function checkLicense(token: string | undefined): Promise<LicenseStatus> {
  return verifyLicense(token);
}

/** Is a licence in force for a feature, without rendering anything? */
export function covers(license: LicensePayload, feature: ProFeature): boolean {
  return licenseCovers(license, feature);
}
