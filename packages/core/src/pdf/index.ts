/**
 * PDF writer — internal.
 *
 * Hand-rolled rather than built on jsPDF or pdf-lib: PDF/A and tagged output
 * need control over the object graph, and that is not something a general
 * purpose writer gives up easily.
 *
 * Not part of the public API for consumers: `render()` is the only supported
 * entry point, and everything here may change in a patch release. It is
 * exported under the `@pkg/core/pdf` subpath solely so `@pkg/pro` can build
 * conformance profiles on the same object model rather than re-implementing
 * one, which is also why that subpath is documented as unstable.
 */

export { ByteWriter, formatNumber, latin1 } from "./bytes.js";
export { ContentStream } from "./content.js";
export type { FillRule, TextItem } from "./content.js";
export { PdfDocument, PdfPage } from "./document.js";
export type {
  PageOptions,
  PdfDocumentInfo,
  PdfDocumentOptions,
  PdfVersion,
  XrefStyle,
} from "./document.js";
export { flate } from "./filters.js";
export {
  dateString,
  dict,
  name,
  PdfDict,
  PdfHexString,
  PdfLiteralString,
  PdfName,
  PdfRef,
  PdfStream,
  ref,
  textString,
} from "./objects.js";
export type { PdfStreamOptions, PdfValue } from "./objects.js";
export { ResourceRegistry } from "./resources.js";
export type { ResourceCategory } from "./resources.js";
export { encodeName, encodeStream, serialize, serializeToBytes } from "./serialize.js";
