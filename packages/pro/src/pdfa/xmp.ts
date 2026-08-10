/**
 * The XMP packet PDF/A requires.
 *
 * A PDF/A file has to carry its conformance claim in XMP metadata — the
 * `pdfaid:part` and `pdfaid:conformance` properties are what a validator reads
 * to know which rules to apply. It also has to agree with the Info dictionary
 * wherever the two overlap: a title in one and a different title in the other
 * is a conformance failure, not a cosmetic inconsistency.
 *
 * Written by hand rather than with an XML library, because the packet is fixed
 * in shape and a dependency that emits attributes in a different order run to
 * run would break byte-identical output.
 */

/** Escape text for XML character data and attribute values. */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * An XMP date: ISO 8601 to the second, with an explicit zone.
 *
 * Milliseconds are dropped because the PDF date string in the Info dictionary
 * has no room for them, and the two must describe the same instant.
 */
export function xmpDate(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export interface XmpFields {
  readonly title?: string | undefined;
  readonly author?: string | undefined;
  readonly subject?: string | undefined;
  readonly keywords?: readonly string[] | undefined;
  readonly creator?: string | undefined;
  readonly producer?: string | undefined;
  readonly createdAt: Date;
  /** PDF/A part number: 2 for PDF/A-2. */
  readonly part: number;
  /** Conformance level: `B` for the 2b profile. */
  readonly conformance: string;
}

/** One `rdf:Alt` holding a single default-language value. */
function altText(property: string, value: string): string {
  return [
    `         <${property}>`,
    "            <rdf:Alt>",
    `               <rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li>`,
    "            </rdf:Alt>",
    `         </${property}>`,
  ].join("\n");
}

/** One `rdf:Seq` of values. */
function sequence(property: string, values: readonly string[]): string {
  return [
    `         <${property}>`,
    "            <rdf:Seq>",
    ...values.map((value) => `               <rdf:li>${escapeXml(value)}</rdf:li>`),
    "            </rdf:Seq>",
    `         </${property}>`,
  ].join("\n");
}

/**
 * Build the XMP packet.
 *
 * The packet is wrapped in the `xpacket` processing instructions and padded
 * with whitespace, both of which the XMP specification calls for so a tool can
 * rewrite the metadata in place without relaying out the file.
 */
export function buildXmp(fields: XmpFields): string {
  const created = xmpDate(fields.createdAt);

  const properties: string[] = [
    `         <pdfaid:part>${fields.part}</pdfaid:part>`,
    `         <pdfaid:conformance>${escapeXml(fields.conformance)}</pdfaid:conformance>`,
    `         <xmp:CreateDate>${created}</xmp:CreateDate>`,
    `         <xmp:ModifyDate>${created}</xmp:ModifyDate>`,
    `         <xmp:MetadataDate>${created}</xmp:MetadataDate>`,
  ];

  if (fields.creator) {
    properties.push(`         <xmp:CreatorTool>${escapeXml(fields.creator)}</xmp:CreatorTool>`);
  }
  if (fields.producer) {
    properties.push(`         <pdf:Producer>${escapeXml(fields.producer)}</pdf:Producer>`);
  }
  if (fields.keywords && fields.keywords.length > 0) {
    properties.push(
      `         <pdf:Keywords>${escapeXml(fields.keywords.join(", "))}</pdf:Keywords>`,
    );
  }
  if (fields.title) properties.push(altText("dc:title", fields.title));
  if (fields.subject) properties.push(altText("dc:description", fields.subject));
  // dc:creator is a sequence even for a single author; an Alt here is one of
  // the more common ways to fail validation.
  if (fields.author) properties.push(sequence("dc:creator", [fields.author]));

  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="@pkg/pro">',
    '   <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '      <rdf:Description rdf:about=""',
    '            xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"',
    '            xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '            xmlns:pdf="http://ns.adobe.com/pdf/1.3/"',
    '            xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    ...properties,
    "      </rdf:Description>",
    "   </rdf:RDF>",
    "</x:xmpmeta>",
    // Padding, per the XMP specification's recommendation.
    ...Array.from({ length: 20 }, () => " ".repeat(80)),
    '<?xpacket end="w"?>',
  ].join("\n");
}
