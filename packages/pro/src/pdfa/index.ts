/**
 * PDF/A-2b.
 *
 * The level-B profile: the file must render identically anywhere, forever. It
 * does not require the structure and reading order that level A does, which is
 * PDF/UA territory and a separate feature.
 *
 * Part 2 rather than part 1 because part 2 permits transparency, and this
 * engine emits transparency groups for CSS `opacity`. Claiming PDF/A-1b would
 * mean either lying or dropping a feature the core already supports correctly.
 *
 * What this adds to a document core already produces:
 *
 * - an XMP packet carrying the conformance claim, agreeing with Info
 * - an OutputIntent with an embedded ICC profile
 * - `/MarkInfo` and a document ID, both required
 *
 * What core already satisfies: fonts are embedded and subset with a ToUnicode
 * CMap, there is no encryption, no JavaScript, no embedded files, no external
 * references, and the trailer carries an `/ID`.
 */

import { pdf } from "@pkg/core";
import type { pdf as PdfModule } from "@pkg/core";

type PdfDocument = InstanceType<typeof PdfModule.PdfDocument>;
type PdfStream = InstanceType<typeof PdfModule.PdfStream>;
type PdfRef = InstanceType<typeof PdfModule.PdfRef>;

const { dict, name, PdfDict, PdfStream, textString } = pdf;
import type { RenderExtension, RenderExtensionContext } from "@pkg/core";

import { buildSrgbIccProfile } from "./icc.js";
import { buildXmp } from "./xmp.js";

export interface PdfAOptions {
  /**
   * ICC profile bytes for the output intent.
   *
   * Defaults to a built sRGB profile. Supply your own when an ingest pipeline
   * mandates a particular one, or when output is destined for press.
   */
  readonly iccProfile?: Uint8Array;
  /** Identifier for the output condition, e.g. `sRGB IEC61966-2.1`. */
  readonly outputCondition?: string;
  /** Number of colour components in the profile. 3 for RGB, 4 for CMYK. */
  readonly outputComponents?: number;
}

const PART = 2;
const CONFORMANCE = "B";

/** The XMP packet, as a stream that must not be compressed. */
function metadataStream(context: RenderExtensionContext): PdfStream {
  const metadata = context.metadata;

  const xmp = buildXmp({
    title: metadata.title,
    author: metadata.author,
    subject: metadata.subject,
    keywords: metadata.keywords,
    creator: "@pkg/core",
    producer: "@pkg/core",
    createdAt: metadata.creationDate ?? new Date(0),
    part: PART,
    conformance: CONFORMANCE,
  });

  const bytes = new TextEncoder().encode(xmp);

  return new PdfStream(
    dict({ Type: name("Metadata"), Subtype: name("XML") }),
    bytes,
    // Uncompressed and unencrypted, so a tool can find and read the packet
    // without parsing the PDF. PDF/A requires exactly that.
    { compress: false },
  );
}

/** The OutputIntent and the ICC profile it names. */
function outputIntent(document: PdfDocument, options: PdfAOptions): PdfRef {
  const profile = options.iccProfile ?? buildSrgbIccProfile();
  const components = options.outputComponents ?? 3;
  const condition = options.outputCondition ?? "sRGB IEC61966-2.1";

  const profileRef = document.add(
    new PdfStream(dict({ N: components }), profile),
  );

  return document.add(
    dict({
      Type: name("OutputIntent"),
      // The subtype is `GTS_PDFA1` for every PDF/A part, including part 2.
      // It names the OutputIntent flavour, not the specification version — a
      // detail that reliably looks like a bug and is not one.
      S: name("GTS_PDFA1"),
      OutputConditionIdentifier: textString(condition),
      Info: textString(condition),
      DestOutputProfile: profileRef,
    }),
  );
}

/**
 * The PDF/A-2b extension.
 *
 * Everything is attached in `finish`, once the page tree exists and every font
 * that will be embedded has been.
 */
export function pdfA2bExtension(options: PdfAOptions = {}): RenderExtension {
  return {
    name: "pdfa-2b",
    finish(context: RenderExtensionContext): void {
      const { document } = context;

      document.catalogExtra.set("Metadata", document.add(metadataStream(context)));
      document.catalogExtra.set("OutputIntents", [outputIntent(document, options)]);

      // Required even for a file with no tagged structure: a validator reads
      // it to know the document does not claim to be tagged.
      if (!document.catalogExtra.has("MarkInfo")) {
        document.catalogExtra.set("MarkInfo", new PdfDict([["Marked", false]]));
      }
    },
  };
}

export { buildSrgbIccProfile } from "./icc.js";
export { buildXmp, escapeXml, xmpDate } from "./xmp.js";
