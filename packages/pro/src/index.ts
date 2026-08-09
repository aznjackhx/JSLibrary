/**
 * @pkg/pro — commercial add-ons. Never published under an open licence.
 *
 * Skeleton only until M8, which lands Ed25519 licence verification and PDF/A-2b
 * as the first real feature.
 *
 * Licence check, when it lands, is `buildDate <= license.updatesUntil` — never
 * `Date.now() <= license.updatesUntil`. A customer's build keeps working
 * forever; the key only gates whether newer releases accept it.
 */

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
