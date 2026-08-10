/**
 * Page resource dictionaries.
 *
 * The registry hands out a stable name per referenced object and reuses it, so
 * a font referenced two hundred times is one object and one resource entry.
 * Names are assigned in first-use order, which keeps output deterministic.
 */

import { PdfDict, type PdfRef, type PdfValue } from "./objects.js";

/**
 * Placeholder for a reserved-but-unbound resource.
 *
 * Serialising one would produce a page that references an object that does not
 * exist, so `toDict` refuses rather than emitting a quietly broken PDF.
 */
const UNBOUND = Symbol("unbound resource");

export type ResourceCategory =
  | "Font"
  | "XObject"
  | "ExtGState"
  | "Shading"
  | "Pattern"
  | "ColorSpace";

const NAME_PREFIX: Record<ResourceCategory, string> = {
  Font: "F",
  XObject: "X",
  ExtGState: "GS",
  Shading: "Sh",
  Pattern: "P",
  ColorSpace: "CS",
};

export class ResourceRegistry {
  /** category -> object key -> resource name */
  readonly #assigned = new Map<ResourceCategory, Map<string, string>>();
  /** category -> resource name -> value, or UNBOUND while reserved */
  readonly #entries = new Map<ResourceCategory, Map<string, PdfValue | typeof UNBOUND>>();

  #categoryMaps(category: ResourceCategory): {
    assigned: Map<string, string>;
    entries: Map<string, PdfValue | typeof UNBOUND>;
  } {
    let assigned = this.#assigned.get(category);
    if (!assigned) {
      assigned = new Map();
      this.#assigned.set(category, assigned);
    }
    let entries = this.#entries.get(category);
    if (!entries) {
      entries = new Map();
      this.#entries.set(category, entries);
    }
    return { assigned, entries };
  }

  /**
   * Register an indirect object and get the name to use in content streams.
   *
   * Registering the same reference again returns the same name without adding
   * a second entry.
   */
  register(category: ResourceCategory, target: PdfRef): string {
    const { assigned, entries } = this.#categoryMaps(category);

    const existing = assigned.get(target.key);
    if (existing !== undefined) return existing;

    const resourceName = `${NAME_PREFIX[category]}${entries.size + 1}`;
    assigned.set(target.key, resourceName);
    entries.set(resourceName, target);
    return resourceName;
  }

  /**
   * Reserve a resource name for an object that does not exist yet.
   *
   * Font programs cannot be written until every page has been emitted — a
   * subset is only complete once all its glyphs are known — but content streams
   * need the name while they are being built. The name is bound with `assign`
   * before the document is serialised.
   */
  reserve(category: ResourceCategory): string {
    const { entries } = this.#categoryMaps(category);
    const resourceName = `${NAME_PREFIX[category]}${entries.size + 1}`;
    entries.set(resourceName, UNBOUND);
    return resourceName;
  }

  /** Bind a reserved name to its object. */
  assign(category: ResourceCategory, resourceName: string, target: PdfRef): void {
    const { assigned, entries } = this.#categoryMaps(category);
    if (!entries.has(resourceName)) {
      throw new RangeError(`Resource ${resourceName} was never reserved in ${category}`);
    }
    entries.set(resourceName, target);
    assigned.set(target.key, resourceName);
  }

  /** Number of distinct objects registered in a category. */
  count(category: ResourceCategory): number {
    return this.#entries.get(category)?.size ?? 0;
  }

  /** The name a reference was given, if it has been registered. */
  nameFor(category: ResourceCategory, target: PdfRef): string | undefined {
    return this.#assigned.get(category)?.get(target.key);
  }

  isEmpty(): boolean {
    for (const entries of this.#entries.values()) {
      if (entries.size > 0) return false;
    }
    return true;
  }

  /** Build the `/Resources` dictionary. */
  toDict(): PdfDict {
    const resources = new PdfDict();
    // Fixed category order so the same registrations always serialise
    // identically, regardless of the order categories were first touched.
    const categories: ResourceCategory[] = [
      "ExtGState",
      "ColorSpace",
      "Pattern",
      "Shading",
      "XObject",
      "Font",
    ];

    for (const category of categories) {
      const entries = this.#entries.get(category);
      if (!entries || entries.size === 0) continue;

      const bound = new PdfDict();
      for (const [resourceName, value] of entries) {
        if (value === UNBOUND) {
          throw new Error(
            `Resource ${resourceName} in ${category} was reserved but never assigned; ` +
              "the page would reference an object that does not exist",
          );
        }
        bound.set(resourceName, value);
      }
      resources.set(category, bound);
    }

    return resources;
  }
}
