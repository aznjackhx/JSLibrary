/**
 * Document assembly: object graph, page tree, cross-reference, trailer.
 *
 * Output is deterministic. Object numbers are handed out in creation order,
 * dictionaries keep insertion order, resource names are assigned in first-use
 * order, and the file identifier is derived from the body bytes rather than
 * from a clock or a random source. Given a pinned creation date, the same input
 * produces byte-identical output — without that, visual regression testing of
 * fragmentation is impossible.
 */

import { ByteWriter, latin1 } from "./bytes.js";
import { ContentStream } from "./content.js";
import {
  dateString,
  dict,
  name,
  PdfDict,
  PdfHexString,
  PdfRef,
  PdfStream,
  ref,
  textString,
  type PdfValue,
} from "./objects.js";
import { ResourceRegistry } from "./resources.js";
import { serialize, serializeToBytes } from "./serialize.js";

export type PdfVersion = "1.4" | "1.5" | "1.6" | "1.7";

/**
 * Cross-reference style.
 *
 * - `stream` (default) is PDF 1.5+, smaller, and required for object streams.
 * - `table` is the classic form, for consumers that predate 1.5.
 */
export type XrefStyle = "stream" | "table";

export interface PdfDocumentInfo {
  readonly title?: string | undefined;
  readonly author?: string | undefined;
  readonly subject?: string | undefined;
  readonly keywords?: readonly string[] | undefined;
  readonly creator?: string | undefined;
  readonly producer?: string | undefined;
  /** Pin this for byte-identical output. Defaults to the current time. */
  readonly creationDate?: Date | undefined;
}

export interface PdfDocumentOptions {
  readonly version?: PdfVersion;
  readonly xref?: XrefStyle;
  /**
   * Pack non-stream objects into object streams. Requires `xref: "stream"`.
   * Default: on when the cross-reference style allows it.
   */
  readonly objectStreams?: boolean;
  readonly info?: PdfDocumentInfo;
}

export interface PageOptions {
  readonly width: number;
  readonly height: number;
}

const DEFAULT_PRODUCER = "@pkg/core";

/** Objects per object stream. Bounded so a huge document does not build one enormous stream. */
const OBJECTS_PER_STREAM = 200;

export class PdfPage {
  /** Operators painted onto this page. */
  readonly content = new ContentStream();
  /** Fonts, images and graphics states this page refers to. */
  readonly resources = new ResourceRegistry();
  /** Link and other annotations, added in M7. */
  readonly annotations: PdfValue[] = [];
  /** Extra page dictionary entries (e.g. `/Group`, `/Tabs`). */
  readonly extra = new PdfDict();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    if (!(width > 0) || !(height > 0)) {
      throw new RangeError(`Page size must be positive, received ${width}x${height}`);
    }
  }
}

export class PdfDocument {
  readonly #objects = new Map<number, PdfValue>();
  readonly #pages: PdfPage[] = [];
  #nextNumber = 1;

  readonly #version: PdfVersion;
  readonly #xrefStyle: XrefStyle;
  readonly #useObjectStreams: boolean;
  readonly #info: PdfDocumentInfo;
  #output: Uint8Array | undefined;

  constructor(options: PdfDocumentOptions = {}) {
    this.#xrefStyle = options.xref ?? "stream";
    // Object streams are only addressable from an xref stream, so the two
    // settings cannot disagree.
    this.#useObjectStreams = (options.objectStreams ?? true) && this.#xrefStyle === "stream";
    this.#version = options.version ?? (this.#xrefStyle === "stream" ? "1.7" : "1.4");
    this.#info = options.info ?? {};

    if (this.#xrefStyle === "stream" && Number.parseFloat(this.#version) < 1.5) {
      throw new RangeError(`Cross-reference streams require PDF 1.5 or later, not ${this.#version}`);
    }
  }

  get pageCount(): number {
    return this.#pages.length;
  }

  get pages(): readonly PdfPage[] {
    return this.#pages;
  }

  /** Reserve an object number without supplying its value yet. */
  reserve(): PdfRef {
    const target = ref(this.#nextNumber);
    this.#nextNumber += 1;
    // Placeholder so the slot exists in numeric order; overwritten by assign().
    this.#objects.set(target.num, null);
    return target;
  }

  /** Fill in a reserved object. */
  assign(target: PdfRef, value: PdfValue): PdfRef {
    if (!this.#objects.has(target.num)) {
      throw new RangeError(`Object ${target.num} was never reserved`);
    }
    this.#objects.set(target.num, value);
    return target;
  }

  /** Add an indirect object and get its reference. */
  add(value: PdfValue): PdfRef {
    return this.assign(this.reserve(), value);
  }

  addPage(options: PageOptions): PdfPage {
    const page = new PdfPage(options.width, options.height);
    this.#pages.push(page);
    return page;
  }

  /**
   * Serialise the whole document.
   *
   * This finalises the document: it builds the page tree, catalog and info
   * dictionary, so later mutations are not reflected. The result is cached, and
   * calling it again returns the same bytes.
   */
  toBytes(): Uint8Array {
    if (this.#output) return this.#output;

    if (this.#pages.length === 0) {
      throw new Error("A PDF must contain at least one page");
    }

    const { catalogRef, infoRef } = this.#buildObjectGraph();
    this.#output = this.#write(catalogRef, infoRef);
    return this.#output;
  }

  // --- Object graph ---------------------------------------------------------

  #buildObjectGraph(): { catalogRef: PdfRef; infoRef: PdfRef } {
    const pagesRef = this.reserve();

    const pageRefs = this.#pages.map((page) => {
      const contentRef = this.add(
        new PdfStream(new PdfDict(), page.content.toBytes()),
      );

      const pageDict = dict({
        Type: name("Page"),
        Parent: pagesRef,
        MediaBox: [0, 0, page.width, page.height],
        Contents: contentRef,
      });

      if (!page.resources.isEmpty()) {
        pageDict.set("Resources", page.resources.toDict());
      } else {
        // An empty dictionary is required rather than omitted: /Resources is
        // inheritable, and omitting it makes a viewer look up the page tree.
        pageDict.set("Resources", new PdfDict());
      }

      if (page.annotations.length > 0) {
        pageDict.set("Annots", [...page.annotations]);
      }

      for (const [key, value] of page.extra.entries) pageDict.set(key, value);

      return this.add(pageDict);
    });

    this.assign(
      pagesRef,
      dict({
        Type: name("Pages"),
        Kids: pageRefs,
        Count: pageRefs.length,
      }),
    );

    const catalogRef = this.add(
      dict({
        Type: name("Catalog"),
        Pages: pagesRef,
      }),
    );

    const infoRef = this.add(this.#buildInfoDict());

    return { catalogRef, infoRef };
  }

  #buildInfoDict(): PdfDict {
    const info = this.#info;
    const created = info.creationDate ?? new Date();
    const keywords = info.keywords?.length ? info.keywords.join(", ") : undefined;

    return dict({
      Title: info.title === undefined ? undefined : textString(info.title),
      Author: info.author === undefined ? undefined : textString(info.author),
      Subject: info.subject === undefined ? undefined : textString(info.subject),
      Keywords: keywords === undefined ? undefined : textString(keywords),
      Creator: textString(info.creator ?? DEFAULT_PRODUCER),
      Producer: textString(info.producer ?? DEFAULT_PRODUCER),
      CreationDate: dateString(created),
      ModDate: dateString(created),
    });
  }

  // --- Serialisation --------------------------------------------------------

  #write(catalogRef: PdfRef, infoRef: PdfRef): Uint8Array {
    const writer = new ByteWriter(8192);

    writer.writeAscii(`%PDF-${this.#version}\n`);
    // Binary comment: marks the file as binary for tools that sniff content.
    writer.writeBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const numbers = [...this.#objects.keys()].sort((a, b) => a - b);

    /** Object number -> where the reader finds it. */
    const locations = new Map<number, XrefEntry>();

    const packed = this.#useObjectStreams ? this.#partitionForObjectStreams(numbers) : null;
    const directNumbers = packed ? packed.direct : numbers;

    // Object streams are written as ordinary stream objects, so they need
    // numbers of their own before anything is emitted.
    const objectStreamRefs: PdfRef[] = [];
    if (packed) {
      for (const group of packed.groups) {
        const streamRef = this.reserve();
        objectStreamRefs.push(streamRef);
        group.forEach((num, index) => {
          locations.set(num, { type: 2, streamNum: streamRef.num, indexInStream: index });
        });
      }
    }

    for (const num of directNumbers) {
      locations.set(num, { type: 1, offset: writer.length, gen: 0 });
      this.#writeIndirectObject(writer, num, this.#objects.get(num) ?? null);
    }

    if (packed) {
      packed.groups.forEach((group, groupIndex) => {
        const streamRef = objectStreamRefs[groupIndex] as PdfRef;
        const stream = this.#buildObjectStream(group);
        locations.set(streamRef.num, { type: 1, offset: writer.length, gen: 0 });
        this.#writeIndirectObject(writer, streamRef.num, stream);
      });
    }

    const size = this.#nextNumber;
    const id = fileIdentifier(writer.toUint8Array());

    if (this.#xrefStyle === "table") {
      this.#writeXrefTable(writer, locations, size, catalogRef, infoRef, id);
    } else {
      this.#writeXrefStream(writer, locations, size, catalogRef, infoRef, id);
    }

    return writer.toUint8Array();
  }

  #writeIndirectObject(writer: ByteWriter, num: number, value: PdfValue): void {
    writer.writeAscii(`${num} 0 obj\n`);
    serialize(value, writer);
    writer.writeAscii("\nendobj\n");
  }

  /**
   * Split objects into those that can live in an object stream and those that
   * cannot.
   *
   * Streams must stay direct — an object stream cannot contain another stream —
   * and so must anything a reader needs before it can decode one.
   */
  #partitionForObjectStreams(numbers: readonly number[]): {
    direct: number[];
    groups: number[][];
  } {
    const direct: number[] = [];
    const compressible: number[] = [];

    for (const num of numbers) {
      const value = this.#objects.get(num) ?? null;
      if (value instanceof PdfStream) direct.push(num);
      else compressible.push(num);
    }

    const groups: number[][] = [];
    for (let i = 0; i < compressible.length; i += OBJECTS_PER_STREAM) {
      groups.push(compressible.slice(i, i + OBJECTS_PER_STREAM));
    }

    return { direct, groups };
  }

  /** Build one `/Type /ObjStm` holding the given objects. */
  #buildObjectStream(numbers: readonly number[]): PdfStream {
    const payloads = numbers.map((num) => serializeToBytes(this.#objects.get(num) ?? null));

    // Header is "num offset" pairs, offsets relative to /First.
    let offset = 0;
    const pairs: string[] = [];
    for (const [index, num] of numbers.entries()) {
      pairs.push(`${num} ${offset}`);
      // One separator byte follows each payload, so offsets stay exact.
      offset += (payloads[index] as Uint8Array).length + 1;
    }

    const header = latin1(`${pairs.join(" ")}\n`);
    const body = new ByteWriter(header.length + offset);
    body.writeBytes(header);
    for (const payload of payloads) {
      body.writeBytes(payload);
      body.writeByte(0x0a);
    }

    return new PdfStream(
      dict({
        Type: name("ObjStm"),
        N: numbers.length,
        First: header.length,
      }),
      body.toUint8Array(),
    );
  }

  #trailerDict(size: number, catalogRef: PdfRef, infoRef: PdfRef, id: PdfHexString): PdfDict {
    return dict({
      Size: size,
      Root: catalogRef,
      Info: infoRef,
      // Both halves are equal for a newly created file; the second half only
      // diverges once a file has been incrementally updated.
      ID: [id, id],
    });
  }

  #writeXrefTable(
    writer: ByteWriter,
    locations: ReadonlyMap<number, XrefEntry>,
    size: number,
    catalogRef: PdfRef,
    infoRef: PdfRef,
    id: PdfHexString,
  ): void {
    const startxref = writer.length;

    writer.writeAscii("xref\n");
    writer.writeAscii(`0 ${size}\n`);
    // Object 0 heads the free list and always has generation 65535.
    writer.writeAscii("0000000000 65535 f \n");

    for (let num = 1; num < size; num += 1) {
      const entry = locations.get(num);
      if (!entry || entry.type !== 1) {
        // A classic table cannot point into an object stream; this only
        // happens if the two settings were allowed to disagree.
        throw new Error(
          `Object ${num} has no file offset — a classic xref table cannot reference it`,
        );
      }
      writer.writeAscii(
        `${String(entry.offset).padStart(10, "0")} ${String(entry.gen).padStart(5, "0")} n \n`,
      );
    }

    writer.writeAscii("trailer\n");
    serialize(this.#trailerDict(size, catalogRef, infoRef, id), writer);
    writer.writeAscii(`\nstartxref\n${startxref}\n%%EOF\n`);
  }

  #writeXrefStream(
    writer: ByteWriter,
    locations: ReadonlyMap<number, XrefEntry>,
    sizeBeforeXref: number,
    catalogRef: PdfRef,
    infoRef: PdfRef,
    id: PdfHexString,
  ): void {
    // The cross-reference stream is itself an object, and must appear in its
    // own table.
    const xrefRef = this.reserve();
    const size = this.#nextNumber;
    const startxref = writer.length;

    // Field widths: type (1 byte), offset or stream number (4), generation or
    // index within stream (2).
    const widths = [1, 4, 2] as const;
    const rowLength = widths[0] + widths[1] + widths[2];
    const rows = new Uint8Array(size * rowLength);

    const writeRow = (num: number, type: number, field2: number, field3: number): void => {
      const base = num * rowLength;
      rows[base] = type;
      rows[base + 1] = (field2 >>> 24) & 0xff;
      rows[base + 2] = (field2 >>> 16) & 0xff;
      rows[base + 3] = (field2 >>> 8) & 0xff;
      rows[base + 4] = field2 & 0xff;
      rows[base + 5] = (field3 >>> 8) & 0xff;
      rows[base + 6] = field3 & 0xff;
    };

    // Object 0: head of the free list.
    writeRow(0, 0, 0, 0xffff);

    for (let num = 1; num < sizeBeforeXref; num += 1) {
      const entry = locations.get(num);
      if (!entry) {
        // Reserved but never assigned: mark free rather than emit a dangling
        // offset a reader would follow into nothing.
        writeRow(num, 0, 0, 0);
      } else if (entry.type === 1) {
        writeRow(num, 1, entry.offset, entry.gen);
      } else {
        writeRow(num, 2, entry.streamNum, entry.indexInStream);
      }
    }

    writeRow(xrefRef.num, 1, startxref, 0);

    const xrefDict = this.#trailerDict(size, catalogRef, infoRef, id);
    xrefDict.set("Type", name("XRef"));
    xrefDict.set("W", [...widths]);
    // Entries are contiguous from 0, so /Index can be left implicit.

    // Reorder so /Type leads, as readers and humans both expect.
    const ordered = dict({ Type: name("XRef") });
    for (const [key, value] of xrefDict.entries) {
      if (key !== "Type") ordered.set(key, value);
    }

    this.#writeIndirectObject(writer, xrefRef.num, new PdfStream(ordered, rows));
    writer.writeAscii(`startxref\n${startxref}\n%%EOF\n`);
  }
}

type XrefEntry =
  | { readonly type: 1; readonly offset: number; readonly gen: number }
  | { readonly type: 2; readonly streamNum: number; readonly indexInStream: number };

/**
 * Derive the file identifier from the body bytes.
 *
 * `/ID` exists so a consumer can tell two files apart, which does not call for
 * a cryptographic hash — and must not call for randomness or a clock, since
 * either would break byte-identical output. Four FNV-1a passes with different
 * offset bases give the 16 bytes the format wants.
 */
function fileIdentifier(body: Uint8Array): PdfHexString {
  const PRIME = 0x01000193;
  const bases = [0x811c9dc5, 0x811c9dc7, 0x811c9dcb, 0x811c9dd1];
  const bytes = new Uint8Array(16);

  bases.forEach((base, index) => {
    let hash = base >>> 0;
    for (const byte of body) {
      hash = (hash ^ byte) >>> 0;
      hash = Math.imul(hash, PRIME) >>> 0;
    }
    bytes[index * 4] = (hash >>> 24) & 0xff;
    bytes[index * 4 + 1] = (hash >>> 16) & 0xff;
    bytes[index * 4 + 2] = (hash >>> 8) & 0xff;
    bytes[index * 4 + 3] = hash & 0xff;
  });

  return new PdfHexString(bytes);
}
